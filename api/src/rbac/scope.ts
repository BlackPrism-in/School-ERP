import type { Tx } from '../db/client.js'
import type { RoleKey } from './permissions.js'
import { forbidden } from '../lib/errors.js'

/**
 * Row-level scope: permissions say WHAT a user may do, this says WHOSE
 * records they may do it to.
 *
 * Deliberately resolved in the API rather than in RLS. A teacher who opens
 * another section's register should get a 403 that explains itself, not a
 * silently empty list they will report as "the app lost my students".
 */
export type AccessScope =
  /** Admin and superadmin: every record in the tenant. */
  | { kind: 'all' }
  /** Teacher: the sections they teach or are class teacher of. */
  | { kind: 'sections'; sectionIds: string[] }
  /** Student and guardian: specific enrolments. */
  | { kind: 'enrolments'; enrolmentIds: string[] }

const SCHOOL_WIDE: readonly RoleKey[] = ['superadmin', 'admin', 'accountant']

export async function resolveAccessScope(
  tx: Tx,
  input: { userId: string; roles: RoleKey[] },
): Promise<AccessScope> {
  if (input.roles.some((r) => SCHOOL_WIDE.includes(r))) return { kind: 'all' }

  if (input.roles.includes('teacher')) {
    const rows = await tx<{ section_id: string }[]>`
      select distinct section_id from (
        select ta.section_id
          from teaching_assignment ta
          join staff st on st.id = ta.staff_id
          join academic_session s on s.id = ta.session_id and s.is_current
         where st.user_id = ${input.userId}
        union
        select sec.id
          from section sec
          join staff st on st.id = sec.class_teacher_id
          join academic_session s on s.id = sec.session_id and s.is_current
         where st.user_id = ${input.userId}
      ) scoped
    `
    return { kind: 'sections', sectionIds: rows.map((r) => r.section_id) }
  }

  if (input.roles.includes('student')) {
    const rows = await tx<{ id: string }[]>`
      select e.id
        from enrolment e
        join student st on st.id = e.student_id
        join academic_session s on s.id = e.session_id and s.is_current
       where st.user_id = ${input.userId}
    `
    return { kind: 'enrolments', enrolmentIds: rows.map((r) => r.id) }
  }

  if (input.roles.includes('guardian')) {
    const rows = await tx<{ id: string }[]>`
      select e.id
        from enrolment e
        join student_guardian sg on sg.student_id = e.student_id
        join guardian g on g.id = sg.guardian_id
        join academic_session s on s.id = e.session_id and s.is_current
       where g.user_id = ${input.userId}
    `
    return { kind: 'enrolments', enrolmentIds: rows.map((r) => r.id) }
  }

  // A user with no scope-bearing role sees nothing, rather than everything.
  return { kind: 'enrolments', enrolmentIds: [] }
}

/**
 * Throws unless the scope permits this student. Call it on every single-record
 * read and write — a permission check alone does not stop a teacher from
 * typing another section's student id into the URL.
 */
export async function assertStudentInScope(
  tx: Tx,
  scope: AccessScope,
  studentId: string,
): Promise<void> {
  if (scope.kind === 'all') return

  if (scope.kind === 'sections') {
    if (scope.sectionIds.length === 0) throw forbidden('You are not assigned to any class.')
    const rows = await tx<{ ok: boolean }[]>`
      select true as ok
        from enrolment e
        join academic_session s on s.id = e.session_id and s.is_current
       where e.student_id = ${studentId}
         and e.section_id in ${tx(scope.sectionIds)}
       limit 1
    `
    if (rows.length === 0) throw forbidden('That student is not in one of your classes.')
    return
  }

  if (scope.enrolmentIds.length === 0) throw forbidden('You have no linked student records.')
  const rows = await tx<{ ok: boolean }[]>`
    select true as ok
      from enrolment e
     where e.student_id = ${studentId}
       and e.id in ${tx(scope.enrolmentIds)}
     limit 1
  `
  if (rows.length === 0) throw forbidden('You do not have access to that student.')
}
