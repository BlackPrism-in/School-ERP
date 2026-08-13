import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, db } from '../src/db/client.js'
import { PERMISSIONS } from '../src/rbac/permissions.js'
import {
  assignTeacher,
  createStaff,
  createStudentWithEnrolment,
  createUser,
  login,
  makeApp,
  resetSchool,
  type Fixture,
} from './helpers.js'

let app: FastifyInstance
let fixture: Fixture
let studentInA: string
let studentInB: string

beforeAll(async () => {
  fixture = await resetSchool()

  await createUser({ tenantId: fixture.tenantId, email: 'admin@test.school', role: 'admin' })
  await createUser({ tenantId: fixture.tenantId, email: 'bursar@test.school', role: 'accountant' })

  const teacherUser = await createUser({
    tenantId: fixture.tenantId,
    email: 'teacher.a@test.school',
    role: 'teacher',
  })
  const teacherStaff = await createStaff({
    tenantId: fixture.tenantId,
    userId: teacherUser,
    employeeNo: 'EMP-001',
    name: 'Ethan',
  })
  // Teaches section A only.
  await assignTeacher({ fixture, staffId: teacherStaff, sectionId: fixture.sectionA })

  const studentUser = await createUser({
    tenantId: fixture.tenantId,
    email: 'pupil@test.school',
    role: 'student',
  })

  const a = await createStudentWithEnrolment({
    fixture,
    admissionNo: 'ADM-A1',
    firstName: 'Aarav',
    sectionId: fixture.sectionA,
    userId: studentUser,
  })
  const b = await createStudentWithEnrolment({
    fixture,
    admissionNo: 'ADM-B1',
    firstName: 'Bhavya',
    sectionId: fixture.sectionB,
  })
  studentInA = a.studentId
  studentInB = b.studentId

  app = await makeApp()
})

afterAll(async () => {
  await app.close()
  await closeDb()
})

describe('permission catalogue', () => {
  it('matches the database exactly', async () => {
    const rows = await db()<{ key: string }[]>`select key from permission order by key`
    expect(rows.map((r) => r.key)).toEqual([...PERMISSIONS].sort())
  })

  it('gives superadmin every permission', async () => {
    const rows = await db()<{ count: string }[]>`
      select count(*) from role_permission rp
        join role r on r.id = rp.role_id
       where r.tenant_id = ${fixture.tenantId} and r.key = 'superadmin'
    `
    expect(Number(rows[0]!.count)).toBe(PERMISSIONS.length)
  })

  it('never gives a teacher fee or user-management permissions', async () => {
    const rows = await db()<{ permission_key: string }[]>`
      select rp.permission_key from role_permission rp
        join role r on r.id = rp.role_id
       where r.tenant_id = ${fixture.tenantId} and r.key = 'teacher'
    `
    const keys = rows.map((r) => r.permission_key)
    expect(keys).not.toContain('fee.collect')
    expect(keys).not.toContain('fee.concession')
    expect(keys).not.toContain('user.manage')
    expect(keys).not.toContain('exam.publish')
  })
})

describe('permission enforcement', () => {
  it('lets an admin create a student', async () => {
    const cookie = await login(app, 'admin@test.school')
    const res = await app.inject({
      method: 'POST',
      url: '/students',
      headers: { cookie },
      payload: { admissionNo: 'ADM-NEW1', firstName: 'Created' },
    })
    expect(res.statusCode).toBe(201)
  })

  it('refuses a teacher creating a student', async () => {
    const cookie = await login(app, 'teacher.a@test.school')
    const res = await app.inject({
      method: 'POST',
      url: '/students',
      headers: { cookie },
      payload: { admissionNo: 'ADM-NOPE', firstName: 'Nope' },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.message).toContain('student.write')
  })

  it('refuses an accountant reading a student they have no permission for', async () => {
    const cookie = await login(app, 'bursar@test.school')
    // accountant has student.read, so the list is allowed...
    const list = await app.inject({ method: 'GET', url: '/students', headers: { cookie } })
    expect(list.statusCode).toBe(200)

    // ...but not student.delete
    const del = await app.inject({
      method: 'DELETE',
      url: `/students/${studentInA}`,
      headers: { cookie },
    })
    expect(del.statusCode).toBe(403)
  })

  it('refuses a student any write at all', async () => {
    const cookie = await login(app, 'pupil@test.school')
    const res = await app.inject({
      method: 'PATCH',
      url: `/students/${studentInA}`,
      headers: { cookie },
      payload: { firstName: 'Hacked' },
    })
    expect(res.statusCode).toBe(403)
  })
})

/**
 * The cases that matter most: a user with a legitimate permission trying to
 * apply it to records outside their scope.
 */
describe('row-level scope', () => {
  it('shows a teacher only their own section', async () => {
    const cookie = await login(app, 'teacher.a@test.school')
    const res = await app.inject({ method: 'GET', url: '/students', headers: { cookie } })

    expect(res.statusCode).toBe(200)
    const names = res.json().data.map((s: { firstName: string }) => s.firstName)
    expect(names).toContain('Aarav')
    expect(names).not.toContain('Bhavya')
    expect(res.json().total).toBe(1)
  })

  it('refuses a teacher reading a student in another section by id', async () => {
    const cookie = await login(app, 'teacher.a@test.school')
    const res = await app.inject({
      method: 'GET',
      url: `/students/${studentInB}`,
      headers: { cookie },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.message).toContain('not in one of your classes')
  })

  it('lets a teacher read a student in their own section', async () => {
    const cookie = await login(app, 'teacher.a@test.school')
    const res = await app.inject({
      method: 'GET',
      url: `/students/${studentInA}`,
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().firstName).toBe('Aarav')
  })

  it('shows a student only their own record', async () => {
    const cookie = await login(app, 'pupil@test.school')
    const list = await app.inject({ method: 'GET', url: '/students', headers: { cookie } })
    expect(list.json().total).toBe(1)
    expect(list.json().data[0].firstName).toBe('Aarav')

    const other = await app.inject({
      method: 'GET',
      url: `/students/${studentInB}`,
      headers: { cookie },
    })
    expect(other.statusCode).toBe(403)
  })

  it('shows an admin every student', async () => {
    const cookie = await login(app, 'admin@test.school')
    const res = await app.inject({ method: 'GET', url: '/students', headers: { cookie } })
    expect(res.json().total).toBeGreaterThanOrEqual(3)
  })

  it('scopes the total count, not just the page', async () => {
    // A teacher paginating must not learn how many students exist school-wide.
    const cookie = await login(app, 'teacher.a@test.school')
    const res = await app.inject({
      method: 'GET',
      url: '/students?pageSize=1',
      headers: { cookie },
    })
    expect(res.json().total).toBe(1)
  })
})
