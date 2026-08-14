import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { env } from '../../env.js'
import { assertSectionInScope } from '../../rbac/scope.js'
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js'
import type { Tx } from '../../db/client.js'

const STATUSES = ['present', 'absent', 'late', 'half_day', 'leave', 'excused'] as const
type Status = (typeof STATUSES)[number]

/** Dates are calendar days in the school's timezone, never timestamps. */
const dateSchema = z.string().date()

const registerQuery = z.object({
  sectionId: z.string().uuid(),
  date: dateSchema,
  periodId: z.string().uuid().optional(),
})

const saveBody = z.object({
  sectionId: z.string().uuid(),
  date: dateSchema,
  periodId: z.string().uuid().optional(),
  entries: z
    .array(
      z.object({
        enrolmentId: z.string().uuid(),
        status: z.enum(STATUSES),
        remarks: z.string().trim().max(300).optional(),
        /** Required when amending a record past the edit window. */
        reason: z.string().trim().max(300).optional(),
      }),
    )
    .min(1)
    .max(200),
})

type SectionContext = {
  id: string
  session_id: string
  name: string
  class_name: string
  session_name: string
  start_date: Date
  end_date: Date
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10)
}

/**
 * Loads the section with its session window, and rejects dates the school
 * could not plausibly be marking:
 *
 *  - outside the academic session's own start/end
 *  - in the future (you cannot know who was present tomorrow)
 *  - on a declared holiday
 *
 * These are real errors, not warnings. A register saved against the wrong date
 * is worse than no register: it silently corrupts a child's attendance
 * percentage, which is the figure schools report to boards and parents.
 */
async function loadSectionForDate(
  tx: Tx,
  sectionId: string,
  date: string,
): Promise<{ section: SectionContext; holiday: { name: string } | null }> {
  const [section] = await tx<SectionContext[]>`
    select sec.id, sec.session_id, sec.name,
           cl.name as class_name,
           s.name as session_name, s.start_date, s.end_date
      from section sec
      join class_level cl on cl.id = sec.class_level_id
      join academic_session s on s.id = sec.session_id
     where sec.id = ${sectionId} and sec.deleted_at is null
  `
  if (!section) throw notFound('No such section.')

  if (date < toDateOnly(section.start_date) || date > toDateOnly(section.end_date)) {
    throw badRequest(
      `${date} is outside the ${section.session_name} session (${toDateOnly(section.start_date)} to ${toDateOnly(section.end_date)}).`,
      'date_outside_session',
    )
  }

  if (date > new Date().toISOString().slice(0, 10)) {
    throw badRequest('Attendance cannot be recorded for a future date.', 'future_date')
  }

  const [holiday] = await tx<{ name: string }[]>`
    select name from holiday
     where session_id = ${section.session_id} and date = ${date}
       and applies_to in ('all', 'students')
  `

  return { section, holiday: holiday ?? null }
}

export async function attendanceRoutes(app: FastifyInstance) {
  /**
   * GET /attendance/register — the roster for one class on one day, with any
   * marks already recorded. Returns unmarked students explicitly rather than
   * omitting them, so the UI can show what still needs doing.
   */
  app.get('/attendance/register', async (request) => {
    const principal = request.require('attendance.read')
    const query = registerQuery.parse(request.query)
    assertSectionInScope(principal.scope, query.sectionId)

    return request.tx(async (tx) => {
      const { section, holiday } = await loadSectionForDate(tx, query.sectionId, query.date)

      const rows = await tx<
        {
          enrolment_id: string
          student_id: string
          first_name: string
          last_name: string | null
          admission_no: string
          roll_no: string | null
          record_id: string | null
          status: Status | null
          remarks: string | null
          marked_at: Date | null
          marked_by_name: string | null
        }[]
      >`
        select e.id as enrolment_id, st.id as student_id, st.first_name, st.last_name,
               st.admission_no, e.roll_no,
               ar.id as record_id, ar.status, ar.remarks, ar.marked_at,
               u.display_name as marked_by_name
          from enrolment e
          join student st on st.id = e.student_id and st.deleted_at is null
          left join attendance_record ar
            on ar.enrolment_id = e.id
           and ar.date = ${query.date}
           and ar.period_id is not distinct from ${query.periodId ?? null}
          left join app_user u on u.id = ar.marked_by
         where e.section_id = ${query.sectionId}
           and e.status = 'enrolled'
         order by (case when e.roll_no ~ '^[0-9]+$' then lpad(e.roll_no, 12, '0') else e.roll_no end) nulls last, st.first_name
      `

      const windowMs = env().ATTENDANCE_EDIT_WINDOW_HOURS * 3_600_000
      const students = rows.map((r) => ({
        enrolmentId: r.enrolment_id,
        studentId: r.student_id,
        name: [r.first_name, r.last_name].filter(Boolean).join(' '),
        admissionNo: r.admission_no,
        rollNo: r.roll_no,
        status: r.status,
        remarks: r.remarks,
        markedAt: r.marked_at,
        markedBy: r.marked_by_name,
        /** Already marked and past the window: changing it is a correction. */
        needsCorrection: Boolean(r.marked_at && Date.now() - r.marked_at.getTime() > windowMs),
      }))

      const counts = { present: 0, absent: 0, late: 0, half_day: 0, leave: 0, excused: 0, unmarked: 0 }
      for (const s of students) {
        if (s.status) counts[s.status] += 1
        else counts.unmarked += 1
      }

      return {
        section: {
          id: section.id,
          name: section.name,
          className: section.class_name,
          sessionName: section.session_name,
        },
        date: query.date,
        holiday,
        canMark: principal.permissions.has('attendance.mark'),
        canCorrect: principal.permissions.has('attendance.correct'),
        editWindowHours: env().ATTENDANCE_EDIT_WINDOW_HOURS,
        students,
        summary: counts,
      }
    })
  })

  /**
   * POST /attendance/register — save the whole register in one transaction.
   *
   * All-or-nothing on purpose: a half-saved register leaves a class where some
   * children are marked absent and others are simply missing, and nobody can
   * tell which is which afterwards.
   */
  app.post('/attendance/register', async (request) => {
    const principal = request.require('attendance.mark')
    const body = saveBody.parse(request.body)
    assertSectionInScope(principal.scope, body.sectionId)

    return request.tx(async (tx) => {
      const { section, holiday } = await loadSectionForDate(tx, body.sectionId, body.date)

      if (holiday) {
        throw conflict(
          `${body.date} is marked as a holiday (${holiday.name}). Remove the holiday first if the school was open.`,
          'is_holiday',
        )
      }

      // Every enrolment must actually be in this section. Without this, a
      // crafted payload could mark a child in another class.
      const enrolmentIds = body.entries.map((e) => e.enrolmentId)
      const valid = await tx<{ id: string }[]>`
        select id from enrolment
         where id in ${tx(enrolmentIds)} and section_id = ${body.sectionId} and status = 'enrolled'
      `
      if (valid.length !== enrolmentIds.length) {
        throw badRequest('Some students in that submission are not enrolled in this section.', 'roster_mismatch')
      }

      const existing = await tx<
        { id: string; enrolment_id: string; status: Status; marked_at: Date }[]
      >`
        select id, enrolment_id, status, marked_at
          from attendance_record
         where enrolment_id in ${tx(enrolmentIds)}
           and date = ${body.date}
           and period_id is not distinct from ${body.periodId ?? null}
      `
      const byEnrolment = new Map(existing.map((r) => [r.enrolment_id, r]))
      const windowMs = env().ATTENDANCE_EDIT_WINDOW_HOURS * 3_600_000

      let created = 0
      let updated = 0
      let corrected = 0

      for (const entry of body.entries) {
        const prior = byEnrolment.get(entry.enrolmentId)

        if (!prior) {
          await tx`
            insert into attendance_record (tenant_id, session_id, enrolment_id, date,
                                           period_id, status, remarks, marked_by)
            values (app_current_tenant(), ${section.session_id}, ${entry.enrolmentId},
                    ${body.date}, ${body.periodId ?? null}, ${entry.status},
                    ${entry.remarks ?? null}, ${principal.user.userId})
          `
          created += 1
          continue
        }

        if (prior.status === entry.status && !entry.remarks) continue

        const pastWindow = Date.now() - prior.marked_at.getTime() > windowMs

        if (pastWindow) {
          // Beyond the window this is an amendment to a settled record, and a
          // parent may already have been told the original figure.
          if (!principal.permissions.has('attendance.correct')) {
            throw forbidden(
              `Attendance for ${body.date} is older than ${env().ATTENDANCE_EDIT_WINDOW_HOURS} hours. Ask an administrator to correct it.`,
              'correction_required',
            )
          }
          if (!entry.reason) {
            throw badRequest(
              'A reason is required when correcting attendance after the edit window.',
              'reason_required',
            )
          }

          await tx`
            insert into attendance_correction (tenant_id, attendance_record_id, previous_status,
                                               new_status, reason, corrected_by)
            values (app_current_tenant(), ${prior.id}, ${prior.status}, ${entry.status},
                    ${entry.reason}, ${principal.user.userId})
          `
          corrected += 1
        } else {
          updated += 1
        }

        await tx`
          update attendance_record
             set status = ${entry.status},
                 remarks = ${entry.remarks ?? null},
                 marked_by = ${principal.user.userId},
                 marked_at = now()
           where id = ${prior.id}
        `
      }

      return { saved: body.entries.length, created, updated, corrected }
    })
  })

  /**
   * GET /attendance/report — per-student totals over a date range.
   *
   * The percentage counts half-days as half a day present, and excludes
   * approved leave and excused absence from the denominator entirely. Getting
   * this wrong understates a sick child's attendance on a report card.
   */
  app.get('/attendance/report', async (request) => {
    const principal = request.require('attendance.read')
    const query = z
      .object({
        sectionId: z.string().uuid(),
        from: dateSchema,
        to: dateSchema,
      })
      .parse(request.query)

    if (query.to < query.from) throw badRequest('The end date must not be before the start date.')
    assertSectionInScope(principal.scope, query.sectionId)

    return request.tx(async (tx) => {
      const rows = await tx<
        {
          enrolment_id: string
          name: string
          roll_no: string | null
          present: string
          absent: string
          late: string
          half_day: string
          leave_count: string
          excused: string
          marked_days: string
        }[]
      >`
        select e.id as enrolment_id,
               trim(st.first_name || ' ' || coalesce(st.last_name, '')) as name,
               e.roll_no,
               count(*) filter (where ar.status = 'present')  as present,
               count(*) filter (where ar.status = 'absent')   as absent,
               count(*) filter (where ar.status = 'late')     as late,
               count(*) filter (where ar.status = 'half_day') as half_day,
               count(*) filter (where ar.status = 'leave')    as leave_count,
               count(*) filter (where ar.status = 'excused')  as excused,
               count(ar.id) as marked_days
          from enrolment e
          join student st on st.id = e.student_id and st.deleted_at is null
          left join attendance_record ar
            on ar.enrolment_id = e.id
           and ar.date between ${query.from} and ${query.to}
         where e.section_id = ${query.sectionId} and e.status = 'enrolled'
         group by e.id, st.first_name, st.last_name
         order by (case when e.roll_no ~ '^[0-9]+$' then lpad(e.roll_no, 12, '0') else e.roll_no end) nulls last, st.first_name
      `

      const students = rows.map((r) => {
        const present = Number(r.present)
        const late = Number(r.late)
        const halfDay = Number(r.half_day)
        const absent = Number(r.absent)
        // Leave and excused are neither present nor counted against them.
        const countable = present + late + halfDay + absent
        const credited = present + late + halfDay * 0.5
        return {
          enrolmentId: r.enrolment_id,
          name: r.name,
          rollNo: r.roll_no,
          present,
          absent,
          late,
          halfDay,
          leave: Number(r.leave_count),
          excused: Number(r.excused),
          markedDays: Number(r.marked_days),
          percentage: countable === 0 ? null : Math.round((credited / countable) * 1000) / 10,
        }
      })

      const [days] = await tx<{ n: string }[]>`
        select count(distinct ar.date) as n
          from attendance_record ar
          join enrolment e on e.id = ar.enrolment_id
         where e.section_id = ${query.sectionId}
           and ar.date between ${query.from} and ${query.to}
      `

      return {
        from: query.from,
        to: query.to,
        daysRecorded: Number(days!.n),
        students,
      }
    })
  })

  // -------------------------------------------------------------- holidays

  app.get('/attendance/holidays', async (request) => {
    request.require('attendance.read')
    const query = z.object({ sessionId: z.string().uuid().optional() }).parse(request.query)

    return request.tx(async (tx) => {
      const rows = await tx<Record<string, unknown>[]>`
        select id, date, name, applies_to as "appliesTo"
          from holiday
         where session_id = ${
           query.sessionId
             ? tx`${query.sessionId}::uuid`
             : tx`(select id from academic_session where is_current limit 1)`
         }
         order by date
      `
      return { data: rows }
    })
  })

  app.post('/attendance/holidays', async (request, reply) => {
    request.require('settings.manage')
    const body = z
      .object({
        date: dateSchema,
        name: z.string().trim().min(1).max(120),
        appliesTo: z.enum(['all', 'students', 'staff']).default('all'),
      })
      .parse(request.body)

    return request.tx(async (tx) => {
      const [session] = await tx<{ id: string }[]>`
        select id from academic_session where is_current limit 1
      `
      if (!session) throw badRequest('No current academic session.')

      const [clash] = await tx<{ n: string }[]>`
        select count(*) as n from attendance_record
         where date = ${body.date} and session_id = ${session.id}
      `
      if (Number(clash!.n) > 0) {
        throw conflict(
          `Attendance has already been recorded for ${body.date}. Remove those records before declaring it a holiday.`,
          'attendance_exists',
        )
      }

      const rows = await tx<{ id: string }[]>`
        insert into holiday (tenant_id, session_id, date, name, applies_to)
        values (app_current_tenant(), ${session.id}, ${body.date}, ${body.name}, ${body.appliesTo})
        on conflict (tenant_id, session_id, date, applies_to) do update set name = excluded.name
        returning id
      `
      reply.code(201)
      return { id: rows[0]!.id }
    })
  })
}
