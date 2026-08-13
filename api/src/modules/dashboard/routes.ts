import type { FastifyInstance } from 'fastify'

/**
 * Real numbers for the dashboard. Every figure is scoped the same way the
 * underlying module is — a teacher's "students" count is their sections, not
 * the school — so the landing screen can never imply access the user does not
 * have.
 *
 * Figures the backend cannot yet produce are simply absent from the response
 * rather than estimated. The UI renders what it is given.
 */
export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard/summary', async (request) => {
    const principal = request.requirePrincipal()

    return request.tx(async (tx) => {
      const [school] = await tx<{ name: string }[]>`
        select name from tenant where id = app_current_tenant()
      `
      const [session] = await tx<{ name: string; start_date: Date; end_date: Date }[]>`
        select name, start_date, end_date from academic_session where is_current limit 1
      `

      const scope = principal.scope
      const canSeeStudents = principal.permissions.has('student.read')

      let students: { total: number; active: number } | null = null
      if (canSeeStudents) {
        const scopeClause =
          scope.kind === 'all'
            ? tx`true`
            : scope.kind === 'sections'
              ? scope.sectionIds.length
                ? tx`e.section_id in ${tx(scope.sectionIds)}`
                : tx`false`
              : scope.enrolmentIds.length
                ? tx`e.id in ${tx(scope.enrolmentIds)}`
                : tx`false`

        const [row] = await tx<{ total: string; active: string }[]>`
          select count(*) as total,
                 count(*) filter (where s.status = 'active') as active
            from student s
            left join enrolment e
              on e.student_id = s.id
             and e.session_id = (select id from academic_session where is_current limit 1)
           where s.deleted_at is null and ${scopeClause}
        `
        students = { total: Number(row!.total), active: Number(row!.active) }
      }

      let staff: { total: number } | null = null
      if (principal.permissions.has('staff.read')) {
        const [row] = await tx<{ total: string }[]>`
          select count(*) as total from staff where deleted_at is null and status = 'active'
        `
        staff = { total: Number(row!.total) }
      }

      let sections: { total: number } | null = null
      if (scope.kind === 'all' || scope.kind === 'sections') {
        const [row] = await tx<{ total: string }[]>`
          select count(*) as total from section
           where deleted_at is null
             and session_id = (select id from academic_session where is_current limit 1)
             and ${scope.kind === 'sections'
               ? scope.sectionIds.length
                 ? tx`id in ${tx(scope.sectionIds)}`
                 : tx`false`
               : tx`true`}
        `
        sections = { total: Number(row!.total) }
      }

      return {
        school: school ? { name: school.name } : null,
        session: session
          ? { name: session.name, startDate: session.start_date, endDate: session.end_date }
          : null,
        students,
        staff,
        sections,
        /**
         * What the API can actually serve today. The UI uses this to decide
         * what to show as live rather than hard-coding a list that drifts out
         * of step with the backend.
         */
        availableModules: ['dashboard', 'students'],
      }
    })
  })
}
