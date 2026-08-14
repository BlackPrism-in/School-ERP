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

/**
 * A deliberate adversarial pass, separate from the per-module tests.
 *
 * The per-module suites check that each feature behaves. This one assumes a
 * signed-in user is actively trying to reach records that are not theirs —
 * the realistic threat in a school, where every teacher, pupil and parent has
 * a legitimate account.
 */

let app: FastifyInstance
let fixture: Fixture
let mine: { studentId: string; enrolmentId: string }
let theirs: { studentId: string; enrolmentId: string }

beforeAll(async () => {
  fixture = await resetSchool()
  await createUser({ tenantId: fixture.tenantId, email: 'admin@test.school', role: 'admin' })

  const teacherUser = await createUser({ tenantId: fixture.tenantId, email: 'teacher.a@test.school', role: 'teacher' })
  const staffId = await createStaff({ tenantId: fixture.tenantId, userId: teacherUser, employeeNo: 'E1', name: 'Maya' })
  await assignTeacher({ fixture, staffId, sectionId: fixture.sectionA })

  const pupilUser = await createUser({ tenantId: fixture.tenantId, email: 'pupil@test.school', role: 'student' })

  mine = await createStudentWithEnrolment({
    fixture, admissionNo: 'SEC-A', firstName: 'Mine', sectionId: fixture.sectionA, userId: pupilUser,
  })
  theirs = await createStudentWithEnrolment({
    fixture, admissionNo: 'SEC-B', firstName: 'Theirs', sectionId: fixture.sectionB,
  })

  app = await makeApp()
})

afterAll(async () => {
  await app.close()
  await closeDb()
})

/**
 * Insecure direct object reference sweep. Every one of these is a URL a
 * curious user could type after seeing an id in their own page source.
 */
describe('IDOR — reaching another section by id', () => {
  const cases: { name: string; url: (f: Fixture, t: typeof theirs) => string; method?: 'GET' }[] = [
    { name: "another section's student", url: (_f, t) => `/students/${t.studentId}` },
    { name: "another student's guardians", url: (_f, t) => `/students/${t.studentId}/guardians` },
    { name: "another student's DPDP consent", url: (_f, t) => `/students/${t.studentId}/consent` },
    { name: "another student's enrolment history", url: (_f, t) => `/students/${t.studentId}/enrolment` },
    { name: "another section's attendance register", url: (f) => `/attendance/register?sectionId=${f.sectionB}&date=2026-07-15` },
    { name: "another section's attendance report", url: (f) => `/attendance/report?sectionId=${f.sectionB}&from=2026-07-01&to=2026-07-31` },
  ]

  for (const testCase of cases) {
    it(`refuses a teacher reading ${testCase.name}`, async () => {
      const cookie = await login(app, 'teacher.a@test.school')
      const res = await app.inject({
        method: testCase.method ?? 'GET',
        url: testCase.url(fixture, theirs),
        headers: { cookie },
      })

      expect([403, 404]).toContain(res.statusCode)
      // Whatever the status, no data leaks in the body.
      expect(res.body).not.toContain('Theirs')
      expect(res.body).not.toContain('SEC-B')
    })
  }

  it('lets the same teacher read their own section, so the refusals mean something', async () => {
    const cookie = await login(app, 'teacher.a@test.school')
    const res = await app.inject({ method: 'GET', url: `/students/${mine.studentId}`, headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Mine')
  })

  it('refuses a student reading any record but their own', async () => {
    const cookie = await login(app, 'pupil@test.school')

    const own = await app.inject({ method: 'GET', url: `/students/${mine.studentId}`, headers: { cookie } })
    expect(own.statusCode).toBe(200)

    const other = await app.inject({ method: 'GET', url: `/students/${theirs.studentId}`, headers: { cookie } })
    expect(other.statusCode).toBe(403)
  })

  it('refuses a student reaching a fee ledger that is not theirs', async () => {
    const cookie = await login(app, 'pupil@test.school')
    const res = await app.inject({ method: 'GET', url: `/fees/student/${theirs.studentId}`, headers: { cookie } })
    expect([403, 404]).toContain(res.statusCode)
  })
})

describe('privilege escalation', () => {
  it('refuses a teacher granting themselves a role', async () => {
    const cookie = await login(app, 'teacher.a@test.school')
    const staff = await app.inject({
      method: 'POST',
      url: '/staff',
      headers: { cookie },
      payload: { employeeNo: 'ESC-1', firstName: 'Escalate' },
    })
    expect(staff.statusCode).toBe(403)
  })

  it('refuses a student writing to any endpoint at all', async () => {
    const cookie = await login(app, 'pupil@test.school')
    const attempts = [
      { method: 'POST' as const, url: '/students', payload: { admissionNo: 'X', firstName: 'Y' } },
      { method: 'POST' as const, url: '/notices', payload: { title: 'x', body: 'y', audiences: [{ type: 'everyone' }] } },
      { method: 'POST' as const, url: '/school/classes', payload: { name: 'Grade 99' } },
      { method: 'POST' as const, url: '/fees/heads', payload: { name: 'Fake Fee' } },
      { method: 'POST' as const, url: '/students/import', payload: { rows: [{ admissionNo: 'A', firstName: 'B' }] } },
    ]
    for (const attempt of attempts) {
      const res = await app.inject({ ...attempt, headers: { cookie } })
      expect(res.statusCode, `${attempt.method} ${attempt.url}`).toBe(403)
    }
  })

  /** The client is told its permissions; it must not be able to assert them. */
  it('ignores a forged permission header', async () => {
    const cookie = await login(app, 'pupil@test.school')
    const res = await app.inject({
      method: 'POST',
      url: '/students',
      headers: { cookie, 'x-permissions': 'student.write', 'x-role': 'admin' },
      payload: { admissionNo: 'FORGE-1', firstName: 'Forged' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('injection and malformed input', () => {
  it('treats SQL metacharacters in a search as literal text', async () => {
    const cookie = await login(app, 'admin@test.school')
    const res = await app.inject({
      method: 'GET',
      url: `/students?q=${encodeURIComponent("'; drop table student; --")}`,
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(0)

    // The table is very much still there.
    const rows = await db()`select 1 from student limit 1`
    expect(rows).toHaveLength(1)
  })

  it('rejects a non-uuid path parameter without a 500', async () => {
    const cookie = await login(app, 'admin@test.school')
    const res = await app.inject({ method: 'GET', url: '/students/not-a-uuid', headers: { cookie } })
    expect(res.statusCode).toBe(400)
  })

  it('never leaks SQL, constraint names or stack traces', async () => {
    const cookie = await login(app, 'admin@test.school')
    const probes = [
      { method: 'GET' as const, url: '/students/00000000-0000-0000-0000-000000000000' },
      { method: 'POST' as const, url: '/students', payload: { admissionNo: 'x'.repeat(500), firstName: 'y' } },
      { method: 'GET' as const, url: '/attendance/register?sectionId=00000000-0000-0000-0000-000000000000&date=2026-07-15' },
    ]
    for (const probe of probes) {
      const res = await app.inject({ ...probe, headers: { cookie } })
      expect(res.body).not.toMatch(/select |insert into|pg_|_fkey|_pkey|node_modules|at Object\./i)
    }
  })
})

describe('response headers', () => {
  it('sets the protective headers helmet provides', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBeDefined()
    expect(res.headers['strict-transport-security']).toBeDefined()
  })

  it('never echoes the session cookie back in a readable form', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@test.school', password: 'CorrectHorseBattery9' },
    })
    const setCookie = String(res.headers['set-cookie'])
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    // The body must not carry the token — only the cookie does.
    expect(res.body).not.toContain(setCookie.split('=')[1]!.split(';')[0]!)
  })
})
