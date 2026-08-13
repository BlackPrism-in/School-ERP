import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { db } from '../src/db/client.js'
import { hashPassword } from '../src/auth/password.js'
import type { RoleKey } from '../src/rbac/permissions.js'

export const TENANT_SLUG = 'test-school'
export const PASSWORD = 'CorrectHorseBattery9'

export type Fixture = {
  tenantId: string
  sessionId: string
  branchId: string
  classId: string
  sectionA: string
  sectionB: string
  subjectId: string
}

/**
 * Wipes and rebuilds the school. Called per test file so ordering between
 * files can never matter.
 */
export async function resetSchool(): Promise<Fixture> {
  const sql = db()

  // Every tenant-scoped table has an FK to tenant, so CASCADE clears the whole
  // graph — including audit_log, whose append-only trigger blocks DELETE but
  // not TRUNCATE. The global `permission` table has no FK to tenant and
  // correctly survives.
  await sql`truncate tenant cascade`

  const [tenant] = await sql<{ id: string }[]>`
    insert into tenant (slug, name) values (${TENANT_SLUG}, 'Test School') returning id
  `
  const tenantId = tenant!.id
  await sql`select seed_system_roles(${tenantId})`

  const [session] = await sql<{ id: string }[]>`
    insert into academic_session (tenant_id, name, start_date, end_date, is_current, status)
    values (${tenantId}, '2026-27', '2026-04-01', '2027-03-31', true, 'active') returning id
  `
  const [branch] = await sql<{ id: string }[]>`
    insert into branch (tenant_id, code, name, is_primary)
    values (${tenantId}, 'MAIN', 'Main Campus', true) returning id
  `
  const [cls] = await sql<{ id: string }[]>`
    insert into class_level (tenant_id, name, sort_order)
    values (${tenantId}, 'Grade 10', 10) returning id
  `
  const [secA] = await sql<{ id: string }[]>`
    insert into section (tenant_id, branch_id, class_level_id, session_id, name)
    values (${tenantId}, ${branch!.id}, ${cls!.id}, ${session!.id}, 'A') returning id
  `
  const [secB] = await sql<{ id: string }[]>`
    insert into section (tenant_id, branch_id, class_level_id, session_id, name)
    values (${tenantId}, ${branch!.id}, ${cls!.id}, ${session!.id}, 'B') returning id
  `
  const [subject] = await sql<{ id: string }[]>`
    insert into subject (tenant_id, name) values (${tenantId}, 'Mathematics') returning id
  `

  return {
    tenantId,
    sessionId: session!.id,
    branchId: branch!.id,
    classId: cls!.id,
    sectionA: secA!.id,
    sectionB: secB!.id,
    subjectId: subject!.id,
  }
}

export async function createUser(input: {
  tenantId: string
  email: string
  role: RoleKey
  password?: string
  mustChangePassword?: boolean
  status?: string
}): Promise<string> {
  const sql = db()
  const [user] = await sql<{ id: string }[]>`
    insert into app_user (tenant_id, email, password_hash, display_name,
                          must_change_password, status)
    values (${input.tenantId}, ${input.email},
            ${await hashPassword(input.password ?? PASSWORD)},
            ${input.email.split('@')[0]!},
            ${input.mustChangePassword ?? false}, ${input.status ?? 'active'})
    returning id
  `
  await sql`
    insert into user_role (user_id, role_id)
    select ${user!.id}, id from role where tenant_id = ${input.tenantId} and key = ${input.role}
  `
  return user!.id
}

export async function createStaff(input: {
  tenantId: string
  userId: string
  employeeNo: string
  name: string
}): Promise<string> {
  const sql = db()
  const [staff] = await sql<{ id: string }[]>`
    insert into staff (tenant_id, user_id, employee_no, first_name, is_teaching)
    values (${input.tenantId}, ${input.userId}, ${input.employeeNo}, ${input.name}, true)
    returning id
  `
  return staff!.id
}

export async function createStudentWithEnrolment(input: {
  fixture: Fixture
  admissionNo: string
  firstName: string
  sectionId: string
  userId?: string | null
}): Promise<{ studentId: string; enrolmentId: string }> {
  const sql = db()
  const [student] = await sql<{ id: string }[]>`
    insert into student (tenant_id, admission_no, first_name, user_id)
    values (${input.fixture.tenantId}, ${input.admissionNo}, ${input.firstName},
            ${input.userId ?? null})
    returning id
  `
  const [enrolment] = await sql<{ id: string }[]>`
    insert into enrolment (tenant_id, student_id, session_id, branch_id, class_level_id, section_id)
    values (${input.fixture.tenantId}, ${student!.id}, ${input.fixture.sessionId},
            ${input.fixture.branchId}, ${input.fixture.classId}, ${input.sectionId})
    returning id
  `
  return { studentId: student!.id, enrolmentId: enrolment!.id }
}

export async function assignTeacher(input: {
  fixture: Fixture
  staffId: string
  sectionId: string
}): Promise<void> {
  const sql = db()
  await sql`
    insert into teaching_assignment (tenant_id, session_id, staff_id, section_id, subject_id)
    values (${input.fixture.tenantId}, ${input.fixture.sessionId}, ${input.staffId},
            ${input.sectionId}, ${input.fixture.subjectId})
  `
}

export async function makeApp(): Promise<FastifyInstance> {
  const app = await buildApp()
  await app.ready()
  return app
}

/** Signs in and returns the session cookie header value. */
export async function login(
  app: FastifyInstance,
  email: string,
  password = PASSWORD,
  totp?: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password, ...(totp ? { totp } : {}) },
  })
  if (res.statusCode !== 200) {
    throw new Error(`Login failed for ${email}: ${res.statusCode} ${res.body}`)
  }
  const cookie = res.cookies.find((c) => c.name === 'edunova_session')
  if (!cookie) throw new Error('No session cookie returned')
  return `edunova_session=${cookie.value}`
}
