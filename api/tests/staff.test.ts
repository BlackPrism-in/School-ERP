import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, db } from '../src/db/client.js'
import { createUser, login, makeApp, resetSchool, type Fixture } from './helpers.js'

let app: FastifyInstance
let fixture: Fixture
let adminCookie: string

beforeAll(async () => {
  fixture = await resetSchool()
  await createUser({ tenantId: fixture.tenantId, email: 'admin@test.school', role: 'admin' })
  await createUser({ tenantId: fixture.tenantId, email: 'bursar@test.school', role: 'accountant' })

  app = await makeApp()
  adminCookie = await login(app, 'admin@test.school')
})

afterAll(async () => {
  await app.close()
  await closeDb()
})

async function newStaff(employeeNo: string, extra: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/staff',
    headers: { cookie: adminCookie },
    payload: { employeeNo, firstName: 'Test', lastName: employeeNo, ...extra },
  })
  expect(res.statusCode).toBe(201)
  return res.json().id as string
}

describe('staff records', () => {
  it('creates and lists staff', async () => {
    await newStaff('EMP-100', { designation: 'Head of Science', department: 'Science' })

    const res = await app.inject({ method: 'GET', url: '/staff', headers: { cookie: adminCookie } })
    expect(res.statusCode).toBe(200)
    const row = res.json().data.find((s: { employeeNo: string }) => s.employeeNo === 'EMP-100')
    expect(row.designation).toBe('Head of Science')
    expect(row.hasAccount).toBe(false)
  })

  it('refuses a duplicate employee number', async () => {
    await newStaff('EMP-DUP')
    const res = await app.inject({
      method: 'POST',
      url: '/staff',
      headers: { cookie: adminCookie },
      payload: { employeeNo: 'EMP-DUP', firstName: 'Other' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('duplicate_employee_no')
  })

  it('searches by name and designation', async () => {
    await newStaff('EMP-SEARCH', { designation: 'Librarian' })
    const res = await app.inject({
      method: 'GET',
      url: '/staff?q=Librarian',
      headers: { cookie: adminCookie },
    })
    expect(res.json().data).toHaveLength(1)
  })

  it('refuses an accountant creating staff', async () => {
    const cookie = await login(app, 'bursar@test.school')
    const res = await app.inject({
      method: 'POST',
      url: '/staff',
      headers: { cookie },
      payload: { employeeNo: 'EMP-NOPE', firstName: 'Nope' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('accounts', () => {
  it('issues a generated password that must be changed, and never a known one', async () => {
    const staffId = await newStaff('EMP-ACC')

    const res = await app.inject({
      method: 'POST',
      url: `/staff/${staffId}/account`,
      headers: { cookie: adminCookie },
      payload: { email: 'newteacher@test.school', role: 'teacher' },
    })
    expect(res.statusCode).toBe(201)

    const { temporaryPassword } = res.json()
    expect(temporaryPassword).toHaveLength(16)

    const [user] = await db()<{ must_change_password: boolean; password_hash: string }[]>`
      select must_change_password, password_hash from app_user where email = 'newteacher@test.school'
    `
    expect(user!.must_change_password).toBe(true)
    // Never stored in the clear.
    expect(user!.password_hash).not.toContain(temporaryPassword)
    expect(user!.password_hash.startsWith('$argon2id$')).toBe(true)

    // The account works, and is immediately gated on changing the password.
    const cookie = await login(app, 'newteacher@test.school', temporaryPassword)
    const blocked = await app.inject({ method: 'GET', url: '/students', headers: { cookie } })
    expect(blocked.json().error.code).toBe('password_change_required')
  })

  it('refuses a second account for the same staff member', async () => {
    const staffId = await newStaff('EMP-ACC2')
    await app.inject({
      method: 'POST',
      url: `/staff/${staffId}/account`,
      headers: { cookie: adminCookie },
      payload: { email: 'first@test.school', role: 'teacher' },
    })
    const res = await app.inject({
      method: 'POST',
      url: `/staff/${staffId}/account`,
      headers: { cookie: adminCookie },
      payload: { email: 'second@test.school', role: 'teacher' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('account_exists')
  })

  it('refuses giving staff a student or guardian role', async () => {
    const staffId = await newStaff('EMP-ROLE')
    const res = await app.inject({
      method: 'POST',
      url: `/staff/${staffId}/account`,
      headers: { cookie: adminCookie },
      payload: { email: 'wrongrole@test.school', role: 'student' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('teaching assignments', () => {
  it('assigns a teacher to a section and surfaces it on their record', async () => {
    const staffId = await newStaff('EMP-TEACH')
    const res = await app.inject({
      method: 'POST',
      url: `/staff/${staffId}/assignments`,
      headers: { cookie: adminCookie },
      payload: { sectionId: fixture.sectionA, subjectId: fixture.subjectId },
    })
    expect(res.statusCode).toBe(201)

    const detail = await app.inject({
      method: 'GET',
      url: `/staff/${staffId}`,
      headers: { cookie: adminCookie },
    })
    expect(detail.json().assignments).toHaveLength(1)
    expect(detail.json().assignments[0].className).toBe('Grade 10')
  })

  it('refuses to assign non-teaching staff', async () => {
    const staffId = await newStaff('EMP-ADMIN-ONLY', { isTeaching: false })
    const res = await app.inject({
      method: 'POST',
      url: `/staff/${staffId}/assignments`,
      headers: { cookie: adminCookie },
      payload: { sectionId: fixture.sectionA, subjectId: fixture.subjectId },
    })
    expect(res.statusCode).toBe(400)
  })

  it('refuses a duplicate assignment', async () => {
    const staffId = await newStaff('EMP-DUP-ASSIGN')
    const payload = { sectionId: fixture.sectionA, subjectId: fixture.subjectId }
    await app.inject({ method: 'POST', url: `/staff/${staffId}/assignments`, headers: { cookie: adminCookie }, payload })
    const res = await app.inject({ method: 'POST', url: `/staff/${staffId}/assignments`, headers: { cookie: adminCookie }, payload })
    expect(res.statusCode).toBe(409)
  })
})

describe('resignation', () => {
  it('refuses while they still teach this session', async () => {
    const staffId = await newStaff('EMP-BUSY')
    await app.inject({
      method: 'POST',
      url: `/staff/${staffId}/assignments`,
      headers: { cookie: adminCookie },
      payload: { sectionId: fixture.sectionA, subjectId: fixture.subjectId },
    })

    const res = await app.inject({ method: 'DELETE', url: `/staff/${staffId}`, headers: { cookie: adminCookie } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('has_assignments')
  })

  /**
   * Their record survives — the registers they signed and marks they entered
   * reference it — but their login must stop working the day they leave.
   */
  it('keeps the record, disables the login and kills live sessions', async () => {
    const staffId = await newStaff('EMP-LEAVER')
    const account = await app.inject({
      method: 'POST',
      url: `/staff/${staffId}/account`,
      headers: { cookie: adminCookie },
      payload: { email: 'leaver@test.school', role: 'teacher' },
    })
    const cookie = await login(app, 'leaver@test.school', account.json().temporaryPassword)
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })).statusCode).toBe(200)

    const res = await app.inject({
      method: 'DELETE',
      url: `/staff/${staffId}`,
      headers: { cookie: adminCookie },
      payload: { exitDate: '2026-08-31' },
    })
    expect(res.statusCode).toBe(200)

    const [row] = await db()<{ status: string; deleted_at: Date | null }[]>`
      select status, deleted_at from staff where id = ${staffId}
    `
    expect(row!.status).toBe('resigned')
    expect(row!.deleted_at).not.toBeNull()

    const [user] = await db()<{ status: string }[]>`
      select status from app_user where email = 'leaver@test.school'
    `
    expect(user!.status).toBe('disabled')

    // Their live session is gone immediately, not at next expiry.
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })).statusCode).toBe(401)
  })
})
