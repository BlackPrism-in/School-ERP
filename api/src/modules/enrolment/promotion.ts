import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { conflict } from '../../lib/errors.js'
import type { Tx } from '../../db/client.js'

/**
 * Year-end promotion.
 *
 * This is the operation that makes the `enrolment` design pay off: promoting a
 * class is inserting a new enrolment row in the next session, not mutating the
 * old one. Last year's attendance, fees and marks stay attached to last year's
 * enrolment and remain correct forever.
 *
 * Preview first, because promotion touches every student in a class at once
 * and there is no sensible way to undo it after fees have been raised against
 * the new year.
 */
export async function promotionRoutes(app: FastifyInstance) {
  app.post('/enrolment/promote/preview', async (request) => {
    request.require('enrolment.manage')
    const body = z
      .object({ fromSectionId: z.string().uuid(), toSectionId: z.string().uuid() })
      .parse(request.body)

    return request.tx(async (tx) => {
      const plan = await buildPlan(tx, body.fromSectionId, body.toSectionId)
      return { ...plan, preview: true }
    })
  })

  app.post('/enrolment/promote', async (request) => {
    const principal = request.require('enrolment.manage')
    const body = z
      .object({
        fromSectionId: z.string().uuid(),
        toSectionId: z.string().uuid(),
        /** Students held back stay in the old class; they are not promoted. */
        retainStudentIds: z.array(z.string().uuid()).max(500).default([]),
      })
      .parse(request.body)

    return request.tx(async (tx) => {
      const plan = await buildPlan(tx, body.fromSectionId, body.toSectionId)
      if (plan.blockers.length) {
        throw conflict(plan.blockers[0]!, 'promotion_blocked')
      }
      // A missing target is always among the blockers above; this narrows the
      // type and would catch it as a 500 rather than a bad insert if it were not.
      const target = plan.target
      if (!target) throw conflict('The class being promoted into does not exist.', 'promotion_blocked')

      const retained = new Set(body.retainStudentIds)
      let promoted = 0

      for (const student of plan.students) {
        if (retained.has(student.studentId)) {
          await tx`
            update enrolment set status = 'retained' where id = ${student.enrolmentId}
          `
          continue
        }

        const [next] = await tx<{ id: string }[]>`
          insert into enrolment (tenant_id, student_id, session_id, branch_id,
                                 class_level_id, section_id, roll_no)
          values (app_current_tenant(), ${student.studentId}, ${target.sessionId},
                  ${target.branchId}, ${target.classLevelId}, ${target.sectionId}, null)
          returning id
        `

        // The link back is what makes a student's path through the school
        // reconstructable years later.
        await tx`
          update enrolment
             set status = 'promoted', promoted_to_id = ${next!.id}
           where id = ${student.enrolmentId}
        `
        promoted += 1
      }

      request.log.info(
        { from: body.fromSectionId, to: body.toSectionId, promoted, by: principal.user.userId },
        'promotion committed',
      )
      return { promoted, retained: retained.size }
    })
  })
}

async function buildPlan(tx: Tx, fromSectionId: string, toSectionId: string) {
  const [from] = await tx<{ id: string; session_id: string; name: string; class_name: string; session_name: string }[]>`
    select sec.id, sec.session_id, sec.name, cl.name as class_name, s.name as session_name
      from section sec
      join class_level cl on cl.id = sec.class_level_id
      join academic_session s on s.id = sec.session_id
     where sec.id = ${fromSectionId} and sec.deleted_at is null
  `
  const [to] = await tx<
    { id: string; session_id: string; branch_id: string; class_level_id: string; capacity: number | null;
      name: string; class_name: string; session_name: string }[]
  >`
    select sec.id, sec.session_id, sec.branch_id, sec.class_level_id, sec.capacity,
           sec.name, cl.name as class_name, s.name as session_name
      from section sec
      join class_level cl on cl.id = sec.class_level_id
      join academic_session s on s.id = sec.session_id
     where sec.id = ${toSectionId} and sec.deleted_at is null
  `

  const blockers: string[] = []
  if (!from) blockers.push('The class being promoted from does not exist.')
  if (!to) blockers.push('The class being promoted into does not exist.')

  if (from && to && from.session_id === to.session_id) {
    blockers.push(
      `Both sections are in ${from.session_name}. Promotion moves students into the next academic session.`,
    )
  }

  const students = from
    ? await tx<{ enrolmentId: string; studentId: string; name: string; rollNo: string | null }[]>`
        select e.id as "enrolmentId", e.student_id as "studentId",
               trim(st.first_name || ' ' || coalesce(st.last_name, '')) as name,
               e.roll_no as "rollNo"
          from enrolment e
          join student st on st.id = e.student_id and st.deleted_at is null
         where e.section_id = ${fromSectionId} and e.status = 'enrolled'
         order by (case when e.roll_no ~ '^[0-9]+$' then lpad(e.roll_no, 12, '0') else e.roll_no end) nulls last, st.first_name
      `
    : []

  if (to && to.capacity !== null && students.length > to.capacity) {
    blockers.push(
      `${students.length} students will not fit in ${to.class_name} ${to.name} (capacity ${to.capacity}).`,
    )
  }

  // Anyone already enrolled in the target session would violate the one
  // enrolment per session rule — catch it here with a readable message.
  if (to && students.length) {
    const already = await tx<{ name: string }[]>`
      select trim(st.first_name || ' ' || coalesce(st.last_name, '')) as name
        from enrolment e
        join student st on st.id = e.student_id
       where e.session_id = ${to.session_id}
         and e.student_id in ${tx(students.map((s) => s.studentId))}
    `
    if (already.length) {
      blockers.push(
        `${already.length} student(s) are already enrolled in ${to.session_name}, including ${already[0]!.name}.`,
      )
    }
  }

  return {
    source: from
      ? { sectionId: from.id, label: `${from.class_name} ${from.name}`, sessionName: from.session_name }
      : null,
    target: to
      ? {
          sectionId: to.id,
          sessionId: to.session_id,
          branchId: to.branch_id,
          classLevelId: to.class_level_id,
          label: `${to.class_name} ${to.name}`,
          sessionName: to.session_name,
        }
      : null,
    students,
    blockers,
  }
}
