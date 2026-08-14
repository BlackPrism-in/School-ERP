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
let adminCookie: string

beforeAll(async () => {
  fixture = await resetSchool()
  await createUser({ tenantId: fixture.tenantId, email: 'admin@test.school', role: 'admin' })

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

  app = await makeApp()
  adminCookie = await login(app, 'admin@test.school')
})

afterAll(async () => {
  await app.close()
  await closeDb()
})

describe('school setup', () => {
  it('creates a class and lists it with its section count', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/school/classes',
      headers: { cookie: adminCookie },
      payload: { name: 'Grade 9', sortOrder: 9 },
    })
    expect(created.statusCode).toBe(201)

    const list = await app.inject({ method: 'GET', url: '/school/classes', headers: { cookie: adminCookie } })
    const names = list.json().data.map((c: { name: string }) => c.name)
    expect(names).toContain('Grade 9')
    expect(names).toContain('Grade 10')

    const grade10 = list.json().data.find((c: { name: string }) => c.name === 'Grade 10')
    expect(grade10.sectionCount).toBe(2)
  })

  it('refuses a duplicate class name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/school/classes',
      headers: { cookie: adminCookie },
      payload: { name: 'Grade 10' },
    })
    expect(res.statusCode).toBe(409)
  })

  /** History must outlive a tidy-up. */
  it('refuses to delete a class that has enrolments', async () => {
    await createStudentWithEnrolment({
      fixture,
      admissionNo: 'DEL-1',
      firstName: 'Enrolled',
      sectionId: fixture.sectionA,
    })

    const res = await app.inject({
      method: 'DELETE',
      url: `/school/classes/${fixture.classId}`,
      headers: { cookie: adminCookie },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('in_use')

    const [row] = await db()<{ deleted_at: Date | null }[]>`
      select deleted_at from class_level where id = ${fixture.classId}
    `
    expect(row!.deleted_at).toBeNull()
  })

  it('creates a section against the current session by default', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/school/sections',
      headers: { cookie: adminCookie },
      payload: { name: 'C', classId: fixture.classId, capacity: 2 },
    })
    expect(res.statusCode).toBe(201)

    const [row] = await db()<{ session_id: string }[]>`
      select session_id from section where id = ${res.json().id}
    `
    expect(row!.session_id).toBe(fixture.sessionId)
  })

  it('refuses setup writes from a teacher', async () => {
    const cookie = await login(app, 'teacher@test.school')
    const res = await app.inject({
      method: 'POST',
      url: '/school/classes',
      headers: { cookie },
      payload: { name: 'Grade 11' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('shows a teacher only the sections they teach', async () => {
    const cookie = await login(app, 'teacher@test.school')
    const res = await app.inject({ method: 'GET', url: '/school/sections', headers: { cookie } })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
    expect(res.json().data[0].id).toBe(fixture.sectionA)
  })

  it('shows an admin every section', async () => {
    const res = await app.inject({ method: 'GET', url: '/school/sections', headers: { cookie: adminCookie } })
    expect(res.json().data.length).toBeGreaterThanOrEqual(2)
  })

  it('keeps only one session current', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/school/sessions',
      headers: { cookie: adminCookie },
      payload: { name: '2027-28', startDate: '2027-04-01', endDate: '2028-03-31', makeCurrent: true },
    })
    expect(res.statusCode).toBe(201)

    const rows = await db()<{ n: string }[]>`select count(*) as n from academic_session where is_current`
    expect(Number(rows[0]!.n)).toBe(1)

    // Put the fixture session back so later tests still make sense.
    await db()`update academic_session set is_current = false where is_current`
    await db()`update academic_session set is_current = true where id = ${fixture.sessionId}`
  })

  it('rejects a session that ends before it starts', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/school/sessions',
      headers: { cookie: adminCookie },
      payload: { name: 'Broken', startDate: '2028-04-01', endDate: '2027-03-31' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('enrolment', () => {
  async function newStudent(admissionNo: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/students',
      headers: { cookie: adminCookie },
      payload: { admissionNo, firstName: 'Test' },
    })
    return res.json().id as string
  }

  it('enrols a student into a section', async () => {
    const id = await newStudent('ENR-1')
    const res = await app.inject({
      method: 'POST',
      url: `/students/${id}/enrolment`,
      headers: { cookie: adminCookie },
      payload: { sectionId: fixture.sectionA, rollNo: '11' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().moved).toBe(false)

    // And it now shows on the roster with its class.
    const detail = await app.inject({
      method: 'GET',
      url: `/students?q=Test`,
      headers: { cookie: adminCookie },
    })
    const row = detail.json().data.find((s: { admissionNo: string }) => s.admissionNo === 'ENR-1')
    expect(row.className).toBe('Grade 10')
    expect(row.rollNo).toBe('11')
  })

  /**
   * Moving a section must reuse the enrolment row, not create a second one —
   * attendance references the enrolment id, so a new row would orphan the
   * child's register history.
   */
  it('moves a student between sections without orphaning their history', async () => {
    const id = await newStudent('ENR-2')
    const first = await app.inject({
      method: 'POST',
      url: `/students/${id}/enrolment`,
      headers: { cookie: adminCookie },
      payload: { sectionId: fixture.sectionA },
    })
    const enrolmentId = first.json().enrolmentId

    await db()`
      insert into attendance_record (tenant_id, session_id, enrolment_id, date, status, marked_by)
      values (${fixture.tenantId}, ${fixture.sessionId}, ${enrolmentId}, '2026-07-10', 'present',
              (select id from app_user where email = 'admin@test.school'))
    `

    const moved = await app.inject({
      method: 'POST',
      url: `/students/${id}/enrolment`,
      headers: { cookie: adminCookie },
      payload: { sectionId: fixture.sectionB },
    })

    expect(moved.statusCode).toBe(200)
    expect(moved.json().moved).toBe(true)
    expect(moved.json().enrolmentId).toBe(enrolmentId)

    const enrolments = await db()`select 1 from enrolment where student_id = ${id}`
    expect(enrolments).toHaveLength(1)

    const history = await db()`select 1 from attendance_record where enrolment_id = ${enrolmentId}`
    expect(history).toHaveLength(1)
  })

  it('refuses a roll number already used in that section', async () => {
    const a = await newStudent('ENR-3')
    const b = await newStudent('ENR-4')
    await app.inject({
      method: 'POST',
      url: `/students/${a}/enrolment`,
      headers: { cookie: adminCookie },
      payload: { sectionId: fixture.sectionA, rollNo: '21' },
    })
    const res = await app.inject({
      method: 'POST',
      url: `/students/${b}/enrolment`,
      headers: { cookie: adminCookie },
      payload: { sectionId: fixture.sectionA, rollNo: '21' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('roll_taken')
  })

  it('refuses to overfill a section with a capacity', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/school/sections',
      headers: { cookie: adminCookie },
      payload: { name: 'Tiny', classId: fixture.classId, capacity: 1 },
    })
    const sectionId = created.json().id

    const a = await newStudent('CAP-1')
    const b = await newStudent('CAP-2')

    const first = await app.inject({
      method: 'POST',
      url: `/students/${a}/enrolment`,
      headers: { cookie: adminCookie },
      payload: { sectionId },
    })
    expect(first.statusCode).toBe(201)

    const second = await app.inject({
      method: 'POST',
      url: `/students/${b}/enrolment`,
      headers: { cookie: adminCookie },
      payload: { sectionId },
    })
    expect(second.statusCode).toBe(409)
    expect(second.json().error.code).toBe('section_full')
  })

  it('refuses to enrol a withdrawn student', async () => {
    const id = await newStudent('ENR-5')
    await app.inject({ method: 'DELETE', url: `/students/${id}`, headers: { cookie: adminCookie } })

    const res = await app.inject({
      method: 'POST',
      url: `/students/${id}/enrolment`,
      headers: { cookie: adminCookie },
      payload: { sectionId: fixture.sectionA },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toContain('Withdrawn')
  })

  it('refuses enrolment from a role without enrolment.manage', async () => {
    const id = await newStudent('ENR-6')
    const cookie = await login(app, 'teacher@test.school')
    const res = await app.inject({
      method: 'POST',
      url: `/students/${id}/enrolment`,
      headers: { cookie },
      payload: { sectionId: fixture.sectionA },
    })
    expect(res.statusCode).toBe(403)
  })
})
