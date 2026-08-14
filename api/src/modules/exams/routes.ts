import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { assertSectionInScope } from '../../rbac/scope.js'
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js'
import type { Tx } from '../../db/client.js'

/**
 * Exams, mark entry and results.
 *
 * The state machine is the point:
 *   draft → scheduled → mark_entry → moderation → published → locked
 *
 * Teachers enter marks only while the exam is in `mark_entry`. Moving past
 * that needs `exam.moderate`; publishing needs `exam.publish`; and a locked
 * exam is rejected by the database trigger from migration 0007, not just by
 * this layer. Marks are the second most disputed thing a school holds after
 * money, so every transition is audited.
 */

const EDITABLE_STATES = ['draft', 'scheduled', 'mark_entry'] as const

export async function examRoutes(app: FastifyInstance) {
  app.get('/exams', async (request) => {
    const principal = request.require('exam.read')
    const query = z.object({ classLevelId: z.string().uuid().optional() }).parse(request.query)

    return request.tx(async (tx) => {
      const rows = await tx<Record<string, unknown>[]>`
        select e.id, e.name, e.status, e.class_level_id as "classLevelId",
               cl.name as "className", et.name as "termName",
               e.published_at as "publishedAt",
               count(distinct es.id) as "subjectCount"
          from exam e
          join class_level cl on cl.id = e.class_level_id
          left join exam_term et on et.id = e.exam_term_id
          left join exam_subject es on es.exam_id = e.id
          join academic_session s on s.id = e.session_id and s.is_current
         where ${query.classLevelId ? tx`e.class_level_id = ${query.classLevelId}` : tx`true`}
           and ${principal.permissions.has('exam.configure') ? tx`true` : tx`e.status <> 'draft'`}
         -- cl.id, not cl.name: ordering by cl.sort_order requires it to be
         -- grouped, and grouping by the class primary key covers every
         -- class_level column functionally.
         group by e.id, cl.id, et.name
         order by cl.sort_order, e.name
      `
      return { data: rows.map((r) => ({ ...r, subjectCount: Number(r.subjectCount) })) }
    })
  })

  app.post('/exams', async (request, reply) => {
    const principal = request.require('exam.configure')
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        classLevelId: z.string().uuid(),
        examTermId: z.string().uuid().optional(),
      })
      .parse(request.body)

    return request.tx(async (tx) => {
      const [session] = await tx<{ id: string }[]>`
        select id from academic_session where is_current limit 1
      `
      if (!session) throw badRequest('No current academic session.')

      const [existing] = await tx<{ id: string }[]>`
        select id from exam
         where session_id = ${session.id} and class_level_id = ${body.classLevelId}
           and name = ${body.name}
      `
      if (existing) throw conflict(`“${body.name}” already exists for that class.`)

      const rows = await tx<{ id: string }[]>`
        insert into exam (tenant_id, session_id, exam_term_id, class_level_id, name, created_by)
        values (app_current_tenant(), ${session.id}, ${body.examTermId ?? null},
                ${body.classLevelId}, ${body.name}, ${principal.user.userId})
        returning id
      `
      reply.code(201)
      return { id: rows[0]!.id, status: 'draft' }
    })
  })

  app.get('/exams/:id', async (request) => {
    request.require('exam.read')
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    return request.tx(async (tx) => {
      const [exam] = await tx<Record<string, unknown>[]>`
        select e.id, e.name, e.status, e.class_level_id as "classLevelId",
               cl.name as "className", e.published_at as "publishedAt"
          from exam e join class_level cl on cl.id = e.class_level_id
         where e.id = ${id}
      `
      if (!exam) throw notFound('No such exam.')

      const subjects = await tx<Record<string, unknown>[]>`
        select es.id, es.subject_id as "subjectId", sub.name as "subjectName",
               es.exam_date as "examDate", es.theory_max as "theoryMax",
               es.practical_max as "practicalMax", es.objective_max as "objectiveMax",
               es.total_max as "totalMax", es.pass_marks as "passMarks",
               count(m.id) as "marksEntered"
          from exam_subject es
          join subject sub on sub.id = es.subject_id
          left join mark m on m.exam_subject_id = es.id
         where es.exam_id = ${id}
         group by es.id, sub.name
         order by es.exam_date nulls last, sub.name
      `
      return { ...exam, subjects: subjects.map((s) => ({ ...s, marksEntered: Number(s.marksEntered) })) }
    })
  })

  app.post('/exams/:id/subjects', async (request, reply) => {
    request.require('exam.configure')
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z
      .object({
        subjectId: z.string().uuid(),
        examDate: z.string().date().optional(),
        theoryMax: z.number().min(0).max(1000).default(0),
        practicalMax: z.number().min(0).max(1000).default(0),
        objectiveMax: z.number().min(0).max(1000).default(0),
        passMarks: z.number().min(0).max(1000).default(0),
      })
      .parse(request.body)

    const total = body.theoryMax + body.practicalMax + body.objectiveMax
    if (total <= 0) throw badRequest('A paper needs a maximum mark above zero.')
    if (body.passMarks > total) throw badRequest('The pass mark cannot exceed the paper total.')

    return request.tx(async (tx) => {
      const [exam] = await tx<{ status: string }[]>`select status from exam where id = ${id}`
      if (!exam) throw notFound('No such exam.')
      if (!EDITABLE_STATES.includes(exam.status as (typeof EDITABLE_STATES)[number])) {
        throw conflict('Papers cannot be changed once mark entry has closed.', 'exam_locked')
      }

      const rows = await tx<{ id: string }[]>`
        insert into exam_subject (tenant_id, exam_id, subject_id, exam_date,
                                  theory_max, practical_max, objective_max, pass_marks)
        values (app_current_tenant(), ${id}, ${body.subjectId}, ${body.examDate ?? null},
                ${body.theoryMax}, ${body.practicalMax}, ${body.objectiveMax}, ${body.passMarks})
        on conflict (exam_id, subject_id) do update
           set exam_date = excluded.exam_date, theory_max = excluded.theory_max,
               practical_max = excluded.practical_max, objective_max = excluded.objective_max,
               pass_marks = excluded.pass_marks
        returning id
      `
      reply.code(201)
      return { id: rows[0]!.id }
    })
  })

  /** Moves the exam through its state machine, checking permission per hop. */
  app.post('/exams/:id/status', async (request) => {
    const principal = request.require('exam.read')
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z
      .object({ status: z.enum(['scheduled', 'mark_entry', 'moderation', 'published', 'locked']) })
      .parse(request.body)

    const required: Record<string, string> = {
      scheduled: 'exam.configure',
      mark_entry: 'exam.configure',
      moderation: 'exam.moderate',
      published: 'exam.publish',
      locked: 'exam.publish',
    }
    if (!principal.permissions.has(required[body.status] as never)) {
      throw forbidden(`Moving an exam to “${body.status}” requires the "${required[body.status]}" permission.`)
    }

    const allowed: Record<string, string[]> = {
      draft: ['scheduled'],
      scheduled: ['mark_entry'],
      mark_entry: ['moderation'],
      moderation: ['published', 'mark_entry'],
      published: ['locked'],
      locked: [],
    }

    return request.tx(async (tx) => {
      const [exam] = await tx<{ status: string }[]>`select status from exam where id = ${id}`
      if (!exam) throw notFound('No such exam.')

      if (!allowed[exam.status]?.includes(body.status)) {
        throw conflict(
          `An exam cannot go from “${exam.status}” to “${body.status}”.`,
          'invalid_transition',
        )
      }

      if (body.status === 'published') {
        await publishResults(tx, id, principal.user.userId)
      } else {
        await tx`update exam set status = ${body.status} where id = ${id}`
      }

      return { id, status: body.status }
    })
  })

  // ---------------------------------------------------------- mark sheets

  app.get('/exams/subjects/:examSubjectId/marks', async (request) => {
    const principal = request.require('exam.read')
    const { examSubjectId } = z.object({ examSubjectId: z.string().uuid() }).parse(request.params)
    const query = z.object({ sectionId: z.string().uuid() }).parse(request.query)
    assertSectionInScope(principal.scope, query.sectionId)

    return request.tx(async (tx) => {
      const [paper] = await tx<
        {
          exam_id: string
          status: string
          subject_name: string
          exam_name: string
          theory_max: string
          practical_max: string
          objective_max: string
          total_max: string
          pass_marks: string
        }[]
      >`
        select es.exam_id, e.status, sub.name as subject_name, e.name as exam_name,
               es.theory_max, es.practical_max, es.objective_max, es.total_max, es.pass_marks
          from exam_subject es
          join exam e on e.id = es.exam_id
          join subject sub on sub.id = es.subject_id
         where es.id = ${examSubjectId}
      `
      if (!paper) throw notFound('No such exam paper.')

      const students = await tx<Record<string, unknown>[]>`
        select e.id as "enrolmentId", e.roll_no as "rollNo",
               trim(st.first_name || ' ' || coalesce(st.last_name, '')) as name,
               m.id as "markId", m.is_absent as "isAbsent",
               m.theory_marks as "theoryMarks", m.practical_marks as "practicalMarks",
               m.objective_marks as "objectiveMarks", m.total_marks as "totalMarks",
               m.grade, m.status as "markStatus"
          from enrolment e
          join student st on st.id = e.student_id and st.deleted_at is null
          left join mark m on m.enrolment_id = e.id and m.exam_subject_id = ${examSubjectId}
         where e.section_id = ${query.sectionId} and e.status = 'enrolled'
         order by e.roll_no nulls last, st.first_name
      `

      return {
        examName: paper.exam_name,
        subjectName: paper.subject_name,
        examStatus: paper.status,
        maxima: {
          theory: Number(paper.theory_max),
          practical: Number(paper.practical_max),
          objective: Number(paper.objective_max),
          total: Number(paper.total_max),
          pass: Number(paper.pass_marks),
        },
        canEnter: paper.status === 'mark_entry' && principal.permissions.has('exam.mark'),
        students,
      }
    })
  })

  app.post('/exams/subjects/:examSubjectId/marks', async (request) => {
    const principal = request.require('exam.mark')
    const { examSubjectId } = z.object({ examSubjectId: z.string().uuid() }).parse(request.params)
    const body = z
      .object({
        sectionId: z.string().uuid(),
        entries: z
          .array(
            z.object({
              enrolmentId: z.string().uuid(),
              isAbsent: z.boolean().default(false),
              theoryMarks: z.number().min(0).nullable().optional(),
              practicalMarks: z.number().min(0).nullable().optional(),
              objectiveMarks: z.number().min(0).nullable().optional(),
            }),
          )
          .min(1)
          .max(200),
      })
      .parse(request.body)

    assertSectionInScope(principal.scope, body.sectionId)

    return request.tx(async (tx) => {
      const [paper] = await tx<{ exam_id: string; status: string; exam_id_status: string }[]>`
        select es.exam_id, e.status from exam_subject es
          join exam e on e.id = es.exam_id
         where es.id = ${examSubjectId}
      `
      if (!paper) throw notFound('No such exam paper.')
      if (paper.status !== 'mark_entry') {
        throw conflict(
          `Marks can only be entered while the exam is open for mark entry (it is “${paper.status}”).`,
          'not_open_for_entry',
        )
      }

      const ids = body.entries.map((e) => e.enrolmentId)
      const valid = await tx<{ id: string }[]>`
        select id from enrolment
         where id in ${tx(ids)} and section_id = ${body.sectionId} and status = 'enrolled'
      `
      if (valid.length !== ids.length) {
        throw badRequest('Some students in that submission are not in this section.', 'roster_mismatch')
      }

      for (const entry of body.entries) {
        // Ticking "absent" while also entering marks is a contradiction. The
        // old code silently nulled the marks, which quietly threw away what a
        // teacher had typed — surface it instead and let them decide.
        if (
          entry.isAbsent &&
          [entry.theoryMarks, entry.practicalMarks, entry.objectiveMarks].some(
            (v) => v !== null && v !== undefined,
          )
        ) {
          throw badRequest(
            'A student marked absent cannot also have marks. Clear the marks or untick absent.',
            'absent_with_marks',
          )
        }

        // The validate_mark trigger enforces the maxima; this writes and lets
        // the database be the authority.
        await tx`
          insert into mark (tenant_id, exam_subject_id, enrolment_id, is_absent,
                            theory_marks, practical_marks, objective_marks, status, entered_by)
          values (app_current_tenant(), ${examSubjectId}, ${entry.enrolmentId}, ${entry.isAbsent},
                  ${entry.isAbsent ? null : entry.theoryMarks ?? null},
                  ${entry.isAbsent ? null : entry.practicalMarks ?? null},
                  ${entry.isAbsent ? null : entry.objectiveMarks ?? null},
                  'draft', ${principal.user.userId})
          on conflict (exam_subject_id, enrolment_id) do update
             set is_absent = excluded.is_absent,
                 theory_marks = excluded.theory_marks,
                 practical_marks = excluded.practical_marks,
                 objective_marks = excluded.objective_marks,
                 entered_by = excluded.entered_by,
                 entered_at = now()
        `
      }

      return { saved: body.entries.length }
    })
  })

  app.get('/exams/:id/results', async (request) => {
    request.require('exam.read')
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    return request.tx(async (tx) => {
      const rows = await tx<Record<string, unknown>[]>`
        select r.enrolment_id as "enrolmentId",
               trim(st.first_name || ' ' || coalesce(st.last_name, '')) as name,
               e.roll_no as "rollNo",
               r.obtained_marks as "obtained", r.max_marks as "maxMarks",
               r.percentage, r.grade, r.rank_in_class as "rank", r.outcome
          from exam_result r
          join enrolment e on e.id = r.enrolment_id
          join student st on st.id = e.student_id
         where r.exam_id = ${id}
         order by r.rank_in_class nulls last
      `
      return { data: rows }
    })
  })
}

/**
 * Publication computes each student's consolidated result once and stores it,
 * rather than deriving it on every read.
 *
 * Storing is right here specifically *because* it is a snapshot: a report card
 * handed to a parent must not silently change if someone later edits a mark.
 * The exam is moved to `published`, after which only `locked` follows.
 */
async function publishResults(tx: Tx, examId: string, userId: string) {
  const [pending] = await tx<{ n: string }[]>`
    select count(*) as n
      from exam_subject es
      join enrolment e on e.section_id in (
             select sec.id from section sec
              where sec.class_level_id = (select class_level_id from exam where id = ${examId})
                and sec.session_id = (select session_id from exam where id = ${examId})
           )
       and e.status = 'enrolled'
      left join mark m on m.exam_subject_id = es.id and m.enrolment_id = e.id
     where es.exam_id = ${examId} and m.id is null
  `
  if (Number(pending!.n) > 0) {
    throw conflict(
      `${pending!.n} mark(s) are still missing. Every paper must be marked before results are published.`,
      'marks_incomplete',
    )
  }

  await tx`delete from exam_result where exam_id = ${examId}`

  await tx`
    with totals as (
      select m.enrolment_id,
             sum(m.total_marks) as obtained,
             sum(es.total_max) as max_marks,
             bool_or(not m.is_absent and m.total_marks < es.pass_marks) as any_fail,
             bool_and(m.is_absent) as all_absent
        from mark m
        join exam_subject es on es.id = m.exam_subject_id
       where es.exam_id = ${examId}
       group by m.enrolment_id
    ),
    scored as (
      select t.*,
             round((t.obtained / nullif(t.max_marks, 0)) * 100, 2) as percentage
        from totals t
    )
    insert into exam_result (tenant_id, exam_id, enrolment_id, obtained_marks, max_marks,
                             percentage, grade, rank_in_class, outcome)
    select app_current_tenant(), ${examId}, s.enrolment_id, s.obtained, s.max_marks,
           s.percentage,
           (select gb.grade from grade_band gb
              join grading_scheme gs on gs.id = gb.grading_scheme_id
             where gs.id = coalesce((select grading_scheme_id from exam where id = ${examId}),
                                    (select id from grading_scheme where is_default limit 1))
               and s.percentage between gb.min_percent and gb.max_percent
             limit 1),
           rank() over (order by s.percentage desc),
           case when s.all_absent then 'absent'
                when s.any_fail then 'fail'
                else 'pass' end
      from scored s
  `

  await tx`
    update exam set status = 'published', published_at = now(), published_by = ${userId}
     where id = ${examId}
  `
  await tx`
    update mark set status = 'published'
     where exam_subject_id in (select id from exam_subject where exam_id = ${examId})
  `
}
