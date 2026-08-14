import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { assertStudentInScope } from '../../rbac/scope.js'

/**
 * Enrolment places a student into a section for one academic session.
 *
 * `unique (student_id, session_id)` in migration 0004 means a student can only
 * be in one place per year, which is what keeps attendance, fees and marks
 * unambiguous. Moving a student between sections mid-year therefore updates
 * the existing enrolment rather than creating a second one — and because
 * attendance references the enrolment id, their register history moves with
 * them instead of being orphaned.
 */
export async function enrolmentRoutes(app: FastifyInstance) {
  app.post('/students/:id/enrolment', async (request, reply) => {
    request.require('enrolment.manage')
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z
      .object({
        sectionId: z.string().uuid(),
        rollNo: z.string().trim().max(20).optional(),
        sessionId: z.string().uuid().optional(),
      })
      .parse(request.body)

    return request.tx(async (tx) => {
      // Deliberately not filtered by deleted_at: a withdrawn student should be
      // told *why* they cannot be enrolled, not reported as non-existent.
      const [student] = await tx<{ id: string; status: string; deleted_at: Date | null }[]>`
        select id, status, deleted_at from student where id = ${id}
      `
      if (!student) throw notFound('No such student.')
      if (student.deleted_at || student.status !== 'active') {
        const label = student.status === 'withdrawn' ? 'Withdrawn' : student.status === 'alumni' ? 'Alumni' : 'Inactive'
        throw badRequest(
          `${label} students cannot be enrolled. Reinstate the record first.`,
          'student_not_active',
        )
      }

      const [section] = await tx<
        { id: string; session_id: string; branch_id: string; class_level_id: string; capacity: number | null }[]
      >`
        select id, session_id, branch_id, class_level_id, capacity
          from section where id = ${body.sectionId} and deleted_at is null
      `
      if (!section) throw notFound('No such section.')

      if (body.sessionId && body.sessionId !== section.session_id) {
        throw badRequest('That section belongs to a different academic session.')
      }

      if (section.capacity !== null) {
        const [count] = await tx<{ n: string }[]>`
          select count(*) as n from enrolment
           where section_id = ${section.id} and status = 'enrolled' and student_id <> ${id}
        `
        if (Number(count!.n) >= section.capacity) {
          throw conflict(`That section is full (${section.capacity} places).`, 'section_full')
        }
      }

      // Roll numbers are unique within a section for the session.
      if (body.rollNo) {
        const [taken] = await tx<{ id: string }[]>`
          select e.id from enrolment e
           where e.section_id = ${section.id} and e.roll_no = ${body.rollNo}
             and e.student_id <> ${id}
        `
        if (taken) throw conflict(`Roll number ${body.rollNo} is already used in that section.`, 'roll_taken')
      }

      const rows = await tx<{ id: string; moved: boolean }[]>`
        insert into enrolment (tenant_id, student_id, session_id, branch_id,
                               class_level_id, section_id, roll_no)
        values (app_current_tenant(), ${id}, ${section.session_id}, ${section.branch_id},
                ${section.class_level_id}, ${section.id}, ${body.rollNo ?? null})
        on conflict (student_id, session_id) do update
           set section_id = excluded.section_id,
               class_level_id = excluded.class_level_id,
               branch_id = excluded.branch_id,
               roll_no = coalesce(excluded.roll_no, enrolment.roll_no)
        returning id, (xmax <> 0) as moved
      `

      reply.code(rows[0]!.moved ? 200 : 201)
      return { enrolmentId: rows[0]!.id, moved: rows[0]!.moved }
    })
  })

  app.get('/students/:id/enrolment', async (request) => {
    const principal = request.require('student.read')
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    return request.tx(async (tx) => {
      // Missing until the Phase 4 IDOR sweep caught it: student.read alone let
      // any teacher pull the full class history of any child in the school by
      // id. The permission says what; this says whose.
      await assertStudentInScope(tx, principal.scope, id)

      const rows = await tx<Record<string, unknown>[]>`
        select e.id, e.roll_no as "rollNo", e.status,
               e.enrolled_on as "enrolledOn",
               sec.id as "sectionId", sec.name as "sectionName",
               cl.name as "className",
               s.name as "sessionName", s.is_current as "isCurrent"
          from enrolment e
          join section sec on sec.id = e.section_id
          join class_level cl on cl.id = e.class_level_id
          join academic_session s on s.id = e.session_id
         where e.student_id = ${id}
         order by s.start_date desc
      `
      return { data: rows }
    })
  })
}
