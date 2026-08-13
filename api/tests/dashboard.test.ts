import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, db } from '../src/db/client.js'
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

beforeAll(async () => {
  fixture = await resetSchool()
  await createUser({ tenantId: fixture.tenantId, email: 'admin@test.school', role: 'admin' })
  await createUser({ tenantId: fixture.tenantId, email: 'bursar@test.school', role: 'accountant' })

  const teacherUser = await createUser({
    tenantId: fixture.tenantId,
    email: 'teacher@test.school',
    role: 'teacher',
  })
  const staffId = await createStaff({
    tenantId: fixture.tenantId,
    userId: teacherUser,
    employeeNo: 'EMP-1',
    name: 'Maya',
  })
  await assignTeacher({ fixture, staffId, sectionId: fixture.sectionA })

  // Two in the teacher's section, one outside it.
  await createStudentWithEnrolment({ fixture, admissionNo: 'A-1', firstName: 'One', sectionId: fixture.sectionA })
  await createStudentWithEnrolment({ fixture, admissionNo: 'A-2', firstName: 'Two', sectionId: fixture.sectionA })
  await createStudentWithEnrolment({ fixture, admissionNo: 'B-1', firstName: 'Three', sectionId: fixture.sectionB })

  app = await makeApp()
})

afterAll(async () => {
  await app.close()
  await closeDb()
})

describe('dashboard summary', () => {
  it('reports the school and current session', async () => {
    const cookie = await login(app, 'admin@test.school')
    const res = await app.inject({ method: 'GET', url: '/dashboard/summary', headers: { cookie } })

    expect(res.statusCode).toBe(200)
    expect(res.json().school.name).toBe('Test School')
    expect(res.json().session.name).toBe('2026-27')
  })

  it('gives an admin the school-wide count', async () => {
    const cookie = await login(app, 'admin@test.school')
    const res = await app.inject({ method: 'GET', url: '/dashboard/summary', headers: { cookie } })
    expect(res.json().students.total).toBe(3)
  })

  /**
   * The figure on the landing screen must not imply access the caller does not
   * have — a teacher seeing "3 students" would be a scope leak in a number.
   */
  it('scopes a teacher to their own sections', async () => {
    const cookie = await login(app, 'teacher@test.school')
    const res = await app.inject({ method: 'GET', url: '/dashboard/summary', headers: { cookie } })

    expect(res.json().students.total).toBe(2)
    expect(res.json().sections.total).toBe(1)
  })

  it('omits figures the caller has no permission for', async () => {
    const teacher = await login(app, 'teacher@test.school')
    const asTeacher = await app.inject({ method: 'GET', url: '/dashboard/summary', headers: { cookie: teacher } })
    // Teachers have no staff.read.
    expect(asTeacher.json().staff).toBeNull()

    const bursar = await login(app, 'bursar@test.school')
    const asBursar = await app.inject({ method: 'GET', url: '/dashboard/summary', headers: { cookie: bursar } })
    expect(asBursar.json().staff).toBeNull()
    expect(asBursar.json().students).not.toBeNull()
  })

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/dashboard/summary' })
    expect(res.statusCode).toBe(401)
  })
})

describe('audit actor labels', () => {
  it('names the actor on trigger-written rows, not just explicit events', async () => {
    const cookie = await login(app, 'admin@test.school')
    await app.inject({
      method: 'POST',
      url: '/students',
      headers: { cookie },
      payload: { admissionNo: 'LABEL-1', firstName: 'Labelled' },
    })

    const [row] = await db()<{ actor_label: string | null }[]>`
      select actor_label from audit_log
       where entity_type = 'student' and action = 'insert'
         and after_data ->> 'admission_no' = 'LABEL-1'
    `
    // Without this the audit trail loses the name the moment a user is removed.
    expect(row!.actor_label).toBe('admin@test.school'.split('@')[0])
  })
})
