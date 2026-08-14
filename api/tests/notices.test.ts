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
let pupilA: { studentId: string; enrolmentId: string }
let pupilB: { studentId: string; enrolmentId: string }

beforeAll(async () => {
  fixture = await resetSchool()
  await createUser({ tenantId: fixture.tenantId, email: 'admin@test.school', role: 'admin' })

  const teacherUser = await createUser({ tenantId: fixture.tenantId, email: 'teacher@test.school', role: 'teacher' })
  const staffId = await createStaff({ tenantId: fixture.tenantId, userId: teacherUser, employeeNo: 'E1', name: 'Maya' })
  await assignTeacher({ fixture, staffId, sectionId: fixture.sectionA })

  const studentAUser = await createUser({ tenantId: fixture.tenantId, email: 'pupil.a@test.school', role: 'student' })
  const studentBUser = await createUser({ tenantId: fixture.tenantId, email: 'pupil.b@test.school', role: 'student' })

  pupilA = await createStudentWithEnrolment({
    fixture, admissionNo: 'N-A', firstName: 'Aarav', sectionId: fixture.sectionA, userId: studentAUser,
  })
  pupilB = await createStudentWithEnrolment({
    fixture, admissionNo: 'N-B', firstName: 'Bhavya', sectionId: fixture.sectionB, userId: studentBUser,
  })

  app = await makeApp()
  adminCookie = await login(app, 'admin@test.school')
})

afterAll(async () => {
  await app.close()
  await closeDb()
})

async function createNotice(payload: Record<string, unknown>) {
  const res = await app.inject({
    method: 'POST',
    url: '/notices',
    headers: { cookie: adminCookie },
    payload,
  })
  expect(res.statusCode).toBe(201)
  return res.json().id as string
}

async function publish(id: string) {
  const res = await app.inject({ method: 'POST', url: `/notices/${id}/publish`, headers: { cookie: adminCookie } })
  expect(res.statusCode).toBe(200)
}

async function feedFor(email: string) {
  const cookie = await login(app, email)
  const res = await app.inject({ method: 'GET', url: '/notices', headers: { cookie } })
  expect(res.statusCode).toBe(200)
  return res.json().data as { id: string; title: string; read: boolean }[]
}

describe('publishing', () => {
  it('keeps a draft invisible until published', async () => {
    const id = await createNotice({
      title: 'Draft notice', body: 'Not ready', audiences: [{ type: 'everyone' }],
    })

    expect((await feedFor('pupil.a@test.school')).some((n) => n.id === id)).toBe(false)

    await publish(id)
    expect((await feedFor('pupil.a@test.school')).some((n) => n.id === id)).toBe(true)
  })

  it('refuses to publish a notice addressed to nobody', async () => {
    const [session] = await db()<{ id: string }[]>`select id from academic_session where is_current`
    const [notice] = await db()<{ id: string }[]>`
      insert into notice (tenant_id, session_id, title, body, created_by)
      values (${fixture.tenantId}, ${session!.id}, 'Orphan', 'No audience',
              (select id from app_user where email = 'admin@test.school'))
      returning id
    `
    const res = await app.inject({
      method: 'POST', url: `/notices/${notice!.id}/publish`, headers: { cookie: adminCookie },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('no_audience')
  })

  it('refuses to republish an archived notice', async () => {
    const id = await createNotice({ title: 'Old', body: 'x', audiences: [{ type: 'everyone' }] })
    await publish(id)
    await app.inject({ method: 'DELETE', url: `/notices/${id}`, headers: { cookie: adminCookie } })

    const res = await app.inject({ method: 'POST', url: `/notices/${id}/publish`, headers: { cookie: adminCookie } })
    expect(res.statusCode).toBe(400)
  })

  it('refuses a student writing a notice', async () => {
    const cookie = await login(app, 'pupil.a@test.school')
    const res = await app.inject({
      method: 'POST', url: '/notices', headers: { cookie },
      payload: { title: 'Hi', body: 'x', audiences: [{ type: 'everyone' }] },
    })
    expect(res.statusCode).toBe(403)
  })
})

/**
 * Audience targeting is the whole point of the module — a notice reaching the
 * wrong families is worse than one that never went out.
 */
describe('audience targeting', () => {
  it('delivers a section notice only to that section', async () => {
    const id = await createNotice({
      title: 'Section A trip', body: 'Bus at 8am',
      audiences: [{ type: 'section', sectionId: fixture.sectionA }],
    })
    await publish(id)

    expect((await feedFor('pupil.a@test.school')).some((n) => n.id === id)).toBe(true)
    expect((await feedFor('pupil.b@test.school')).some((n) => n.id === id)).toBe(false)
  })

  it('delivers a class notice to every section of that class', async () => {
    const id = await createNotice({
      title: 'Grade 10 exam schedule', body: 'Starts Monday',
      audiences: [{ type: 'class_level', classLevelId: fixture.classId }],
    })
    await publish(id)

    expect((await feedFor('pupil.a@test.school')).some((n) => n.id === id)).toBe(true)
    expect((await feedFor('pupil.b@test.school')).some((n) => n.id === id)).toBe(true)
  })

  it('delivers a role notice only to that role', async () => {
    const id = await createNotice({
      title: 'Staff meeting', body: 'Friday 4pm',
      audiences: [{ type: 'role', roleKey: 'teacher' }],
    })
    await publish(id)

    expect((await feedFor('teacher@test.school')).some((n) => n.id === id)).toBe(true)
    expect((await feedFor('pupil.a@test.school')).some((n) => n.id === id)).toBe(false)
  })

  it('delivers a single-student notice to nobody else', async () => {
    const id = await createNotice({
      title: 'Personal', body: 'Please see the office',
      audiences: [{ type: 'student', studentId: pupilA.studentId }],
    })
    await publish(id)

    expect((await feedFor('pupil.a@test.school')).some((n) => n.id === id)).toBe(true)
    expect((await feedFor('pupil.b@test.school')).some((n) => n.id === id)).toBe(false)
  })

  it('reaches a teacher through the sections they teach', async () => {
    const id = await createNotice({
      title: 'Section A parents evening', body: 'Thursday',
      audiences: [{ type: 'section', sectionId: fixture.sectionA }],
    })
    await publish(id)
    expect((await feedFor('teacher@test.school')).some((n) => n.id === id)).toBe(true)
  })

  it('refuses direct access to a notice not addressed to you', async () => {
    const id = await createNotice({
      title: 'Section B only', body: 'x',
      audiences: [{ type: 'section', sectionId: fixture.sectionB }],
    })
    await publish(id)

    const cookie = await login(app, 'pupil.a@test.school')
    const res = await app.inject({ method: 'GET', url: `/notices/${id}`, headers: { cookie } })
    expect(res.statusCode).toBe(403)
  })

  /** A student changing section must immediately lose the old class's notices. */
  it('follows a student when they move section', async () => {
    const id = await createNotice({
      title: 'Section B swimming', body: 'x',
      audiences: [{ type: 'section', sectionId: fixture.sectionB }],
    })
    await publish(id)

    expect((await feedFor('pupil.a@test.school')).some((n) => n.id === id)).toBe(false)

    await db()`update enrolment set section_id = ${fixture.sectionB} where id = ${pupilA.enrolmentId}`
    expect((await feedFor('pupil.a@test.school')).some((n) => n.id === id)).toBe(true)

    await db()`update enrolment set section_id = ${fixture.sectionA} where id = ${pupilA.enrolmentId}`
    expect((await feedFor('pupil.a@test.school')).some((n) => n.id === id)).toBe(false)
    void pupilB
  })
})

describe('expiry and read receipts', () => {
  it('hides an expired notice', async () => {
    const id = await createNotice({
      title: 'Expired', body: 'x', audiences: [{ type: 'everyone' }],
      publishAt: new Date(Date.now() - 172_800_000).toISOString(),
      expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
    })
    await publish(id)
    expect((await feedFor('pupil.a@test.school')).some((n) => n.id === id)).toBe(false)
  })

  it('hides a notice scheduled for the future', async () => {
    const id = await createNotice({
      title: 'Future', body: 'x', audiences: [{ type: 'everyone' }],
      publishAt: new Date(Date.now() + 86_400_000).toISOString(),
    })
    await publish(id)
    expect((await feedFor('pupil.a@test.school')).some((n) => n.id === id)).toBe(false)
  })

  it('marks a notice read when opened, and counts it for the author', async () => {
    const id = await createNotice({
      title: 'Read me', body: 'x', audiences: [{ type: 'everyone' }],
    })
    await publish(id)

    const before = (await feedFor('pupil.a@test.school')).find((n) => n.id === id)
    expect(before!.read).toBe(false)

    const cookie = await login(app, 'pupil.a@test.school')
    await app.inject({ method: 'GET', url: `/notices/${id}`, headers: { cookie } })

    const after = (await feedFor('pupil.a@test.school')).find((n) => n.id === id)
    expect(after!.read).toBe(true)

    const authorView = await app.inject({
      method: 'GET', url: `/notices/${id}`, headers: { cookie: adminCookie },
    })
    expect(authorView.json().readCount).toBe(1)
  })

  it('does not mark read for the author merely opening their own notice', async () => {
    const id = await createNotice({ title: 'Author view', body: 'x', audiences: [{ type: 'everyone' }] })
    await publish(id)
    await app.inject({ method: 'GET', url: `/notices/${id}`, headers: { cookie: adminCookie } })

    const [row] = await db()<{ n: string }[]>`
      select count(*) as n from notice_read where notice_id = ${id}
    `
    expect(Number(row!.n)).toBe(0)
  })
})
