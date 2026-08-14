import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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
let teacherCookie: string
let pupils: { studentId: string; enrolmentId: string }[]
let outsider: { studentId: string; enrolmentId: string }

/** A date inside the 2026-27 fixture session and safely in the past. */
const DAY = '2026-07-15'
const DAY_2 = '2026-07-16'

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

  pupils = [
    await createStudentWithEnrolment({ fixture, admissionNo: 'A-1', firstName: 'Aarav', sectionId: fixture.sectionA }),
    await createStudentWithEnrolment({ fixture, admissionNo: 'A-2', firstName: 'Diya', sectionId: fixture.sectionA }),
    await createStudentWithEnrolment({ fixture, admissionNo: 'A-3', firstName: 'Ishaan', sectionId: fixture.sectionA }),
  ]
  outsider = await createStudentWithEnrolment({
    fixture,
    admissionNo: 'B-1',
    firstName: 'Bhavya',
    sectionId: fixture.sectionB,
  })

  app = await makeApp()
  adminCookie = await login(app, 'admin@test.school')
  teacherCookie = await login(app, 'teacher@test.school')
})

afterAll(async () => {
  await app.close()
  await closeDb()
})

beforeEach(async () => {
  await db()`delete from attendance_correction`
  await db()`delete from attendance_record`
  await db()`delete from holiday`
})

function entries(statuses: string[]) {
  return pupils.map((p, i) => ({ enrolmentId: p.enrolmentId, status: statuses[i]! }))
}

async function save(cookie: string, payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/attendance/register',
    headers: { cookie },
    payload,
  })
}

describe('register', () => {
  it('lists the whole roster with unmarked students shown explicitly', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/attendance/register?sectionId=${fixture.sectionA}&date=${DAY}`,
      headers: { cookie: teacherCookie },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.students).toHaveLength(3)
    expect(body.students.every((s: { status: null }) => s.status === null)).toBe(true)
    expect(body.summary.unmarked).toBe(3)
    expect(body.section.className).toBe('Grade 10')
  })

  it('saves a register and reflects it on reload', async () => {
    const res = await save(teacherCookie, {
      sectionId: fixture.sectionA,
      date: DAY,
      entries: entries(['present', 'absent', 'late']),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ created: 3, updated: 0, corrected: 0 })

    const reload = await app.inject({
      method: 'GET',
      url: `/attendance/register?sectionId=${fixture.sectionA}&date=${DAY}`,
      headers: { cookie: teacherCookie },
    })
    expect(reload.json().summary).toMatchObject({ present: 1, absent: 1, late: 1, unmarked: 0 })
    expect(reload.json().students[0].markedBy).toBe('teacher')
  })

  it('updates without a correction inside the edit window', async () => {
    await save(teacherCookie, {
      sectionId: fixture.sectionA,
      date: DAY,
      entries: entries(['present', 'absent', 'late']),
    })
    const res = await save(teacherCookie, {
      sectionId: fixture.sectionA,
      date: DAY,
      entries: entries(['present', 'present', 'late']),
    })

    expect(res.json()).toMatchObject({ created: 0, updated: 1, corrected: 0 })
    const corrections = await db()`select 1 from attendance_correction`
    expect(corrections).toHaveLength(0)
  })
})

/**
 * The rules that stop a register being saved against a date the school could
 * not have been marking. A register on the wrong date silently corrupts the
 * attendance percentage that goes to parents and boards.
 */
describe('date rules', () => {
  it('refuses a future date', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    const res = await save(teacherCookie, {
      sectionId: fixture.sectionA,
      date: tomorrow,
      entries: entries(['present', 'present', 'present']),
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('future_date')
  })

  it('refuses a date outside the academic session', async () => {
    const res = await save(teacherCookie, {
      sectionId: fixture.sectionA,
      date: '2026-02-10',
      entries: entries(['present', 'present', 'present']),
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('date_outside_session')
  })

  it('refuses to mark on a declared holiday', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/attendance/holidays',
      headers: { cookie: adminCookie },
      payload: { date: DAY, name: 'Founders Day' },
    })
    expect(created.statusCode).toBe(201)

    const res = await save(teacherCookie, {
      sectionId: fixture.sectionA,
      date: DAY,
      entries: entries(['present', 'present', 'present']),
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('is_holiday')
    expect(res.json().error.message).toContain('Founders Day')
  })

  it('refuses to declare a holiday on a day already marked', async () => {
    await save(teacherCookie, {
      sectionId: fixture.sectionA,
      date: DAY,
      entries: entries(['present', 'present', 'present']),
    })
    const res = await app.inject({
      method: 'POST',
      url: '/attendance/holidays',
      headers: { cookie: adminCookie },
      payload: { date: DAY, name: 'Retroactive holiday' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('attendance_exists')
  })
})

describe('corrections past the edit window', () => {
  async function markAndAge() {
    await save(teacherCookie, {
      sectionId: fixture.sectionA,
      date: DAY,
      entries: entries(['present', 'absent', 'present']),
    })
    // Push the records beyond the 48h window.
    await db()`update attendance_record set marked_at = now() - interval '5 days'`
  }

  it('refuses a teacher amending a settled record', async () => {
    await markAndAge()
    const res = await save(teacherCookie, {
      sectionId: fixture.sectionA,
      date: DAY,
      entries: entries(['present', 'present', 'present']),
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('correction_required')
    // And nothing was written — the save is all-or-nothing.
    const [row] = await db()<{ status: string }[]>`
      select status from attendance_record where enrolment_id = ${pupils[1]!.enrolmentId}
    `
    expect(row!.status).toBe('absent')
  })

  it('requires a written reason even from an administrator', async () => {
    await markAndAge()
    const res = await save(adminCookie, {
      sectionId: fixture.sectionA,
      date: DAY,
      entries: entries(['present', 'present', 'present']),
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('reason_required')
  })

  it('records the correction with before and after state', async () => {
    await markAndAge()
    const res = await save(adminCookie, {
      sectionId: fixture.sectionA,
      date: DAY,
      entries: [
        { enrolmentId: pupils[0]!.enrolmentId, status: 'present' },
        {
          enrolmentId: pupils[1]!.enrolmentId,
          status: 'present',
          reason: 'Medical certificate produced by parent',
        },
        { enrolmentId: pupils[2]!.enrolmentId, status: 'present' },
      ],
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ corrected: 1 })

    const [correction] = await db()<
      { previous_status: string; new_status: string; reason: string }[]
    >`select previous_status, new_status, reason from attendance_correction`

    expect(correction).toMatchObject({
      previous_status: 'absent',
      new_status: 'present',
      reason: 'Medical certificate produced by parent',
    })
  })
})

describe('scope and roster integrity', () => {
  it('refuses a teacher marking a section they do not teach', async () => {
    const res = await save(teacherCookie, {
      sectionId: fixture.sectionB,
      date: DAY,
      entries: [{ enrolmentId: outsider.enrolmentId, status: 'absent' }],
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.message).toContain('not assigned')
  })

  it('refuses a reader viewing another section’s register', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/attendance/register?sectionId=${fixture.sectionB}&date=${DAY}`,
      headers: { cookie: teacherCookie },
    })
    expect(res.statusCode).toBe(403)
  })

  /** A crafted payload must not be able to mark a child in another class. */
  it('rejects an enrolment that belongs to a different section', async () => {
    const res = await save(adminCookie, {
      sectionId: fixture.sectionA,
      date: DAY,
      entries: [
        { enrolmentId: pupils[0]!.enrolmentId, status: 'present' },
        { enrolmentId: outsider.enrolmentId, status: 'absent' },
      ],
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('roster_mismatch')

    const written = await db()`select 1 from attendance_record`
    expect(written).toHaveLength(0)
  })

  it('refuses a student any access to a class register', async () => {
    const studentUser = await createUser({
      tenantId: fixture.tenantId,
      email: 'pupil@test.school',
      role: 'student',
    })
    await db()`update student set user_id = ${studentUser} where id = ${pupils[0]!.studentId}`
    const cookie = await login(app, 'pupil@test.school')

    const res = await app.inject({
      method: 'GET',
      url: `/attendance/register?sectionId=${fixture.sectionA}&date=${DAY}`,
      headers: { cookie },
    })
    expect(res.statusCode).toBe(403)
  })
})

/**
 * Percentage arithmetic. Getting this wrong understates a sick child's
 * attendance on their report card, which is exactly the kind of error a parent
 * will notice and dispute.
 */
/**
 * Migration 0014. Corrections were already recorded, but a change *inside*
 * the edit window used to leave no trace at all — and absences are the
 * records parents dispute most.
 */
describe('audit trail', () => {
  /**
   * audit_log is append-only by design, so beforeEach cannot clear it and
   * counts accumulate across tests. Each assertion is scoped to entries
   * written after this watermark.
   */
  async function watermark(): Promise<number> {
    const [row] = await db()<{ id: string | null }[]>`select max(id) as id from audit_log`
    return Number(row!.id ?? 0)
  }

  it('records the original marking', async () => {
    const since = await watermark()
    await save(teacherCookie, {
      sectionId: fixture.sectionA,
      date: DAY,
      entries: entries(['present', 'absent', 'present']),
    })

    const rows = await db()<{ n: string }[]>`
      select count(*) as n from audit_log
       where id > ${since} and entity_type = 'attendance_record' and action = 'insert'
    `
    expect(Number(rows[0]!.n)).toBe(3)
  })

  it('records an in-window edit, which leaves no correction row', async () => {
    const since = await watermark()
    await save(teacherCookie, {
      sectionId: fixture.sectionA,
      date: DAY,
      entries: entries(['present', 'absent', 'present']),
    })
    await save(teacherCookie, {
      sectionId: fixture.sectionA,
      date: DAY,
      entries: entries(['present', 'present', 'present']),
    })

    // No correction row — this was inside the window.
    expect(await db()`select 1 from attendance_correction`).toHaveLength(0)

    // But the change is still fully reconstructable.
    const [row] = await db()<
      { before_data: Record<string, unknown>; after_data: Record<string, unknown>; actor_label: string | null }[]
    >`
      select before_data, after_data, actor_label from audit_log
       where id > ${since} and entity_type = 'attendance_record' and action = 'update'
    `
    expect(row!.before_data.status).toBe('absent')
    expect(row!.after_data.status).toBe('present')
    expect(row!.actor_label).toBe('teacher')
  })

  it('audits the correction row itself', async () => {
    const since = await watermark()
    await save(teacherCookie, {
      sectionId: fixture.sectionA,
      date: DAY,
      entries: entries(['present', 'absent', 'present']),
    })
    await db()`update attendance_record set marked_at = now() - interval '5 days'`
    await save(adminCookie, {
      sectionId: fixture.sectionA,
      date: DAY,
      entries: [
        { enrolmentId: pupils[0]!.enrolmentId, status: 'present' },
        { enrolmentId: pupils[1]!.enrolmentId, status: 'present', reason: 'Certificate produced' },
        { enrolmentId: pupils[2]!.enrolmentId, status: 'present' },
      ],
    })

    const [row] = await db()<{ after_data: Record<string, unknown> }[]>`
      select after_data from audit_log
       where id > ${since} and entity_type = 'attendance_correction'
    `
    expect(row!.after_data.reason).toBe('Certificate produced')
  })
})

describe('report', () => {
  it('counts a half-day as half present and excludes approved leave', async () => {
    await save(adminCookie, {
      sectionId: fixture.sectionA,
      date: DAY,
      entries: [
        { enrolmentId: pupils[0]!.enrolmentId, status: 'present' },
        { enrolmentId: pupils[1]!.enrolmentId, status: 'half_day' },
        { enrolmentId: pupils[2]!.enrolmentId, status: 'leave' },
      ],
    })
    await save(adminCookie, {
      sectionId: fixture.sectionA,
      date: DAY_2,
      entries: [
        { enrolmentId: pupils[0]!.enrolmentId, status: 'absent' },
        { enrolmentId: pupils[1]!.enrolmentId, status: 'present' },
        { enrolmentId: pupils[2]!.enrolmentId, status: 'present' },
      ],
    })

    const res = await app.inject({
      method: 'GET',
      url: `/attendance/report?sectionId=${fixture.sectionA}&from=${DAY}&to=${DAY_2}`,
      headers: { cookie: adminCookie },
    })
    expect(res.statusCode).toBe(200)

    const byName = Object.fromEntries(
      res.json().students.map((s: { name: string }) => [s.name.trim(), s]),
    )

    // 1 present of 2 countable days = 50%
    expect(byName.Aarav.percentage).toBe(50)
    // half_day (0.5) + present (1) = 1.5 of 2 = 75%
    expect(byName.Diya.percentage).toBe(75)
    // leave is excluded from the denominator entirely: 1 of 1 = 100%
    expect(byName.Ishaan.percentage).toBe(100)
    expect(byName.Ishaan.leave).toBe(1)

    expect(res.json().daysRecorded).toBe(2)
  })

  it('returns null rather than zero when nothing is countable', async () => {
    await save(adminCookie, {
      sectionId: fixture.sectionA,
      date: DAY,
      entries: entries(['leave', 'leave', 'leave']),
    })

    const res = await app.inject({
      method: 'GET',
      url: `/attendance/report?sectionId=${fixture.sectionA}&from=${DAY}&to=${DAY}`,
      headers: { cookie: adminCookie },
    })
    // 0% would imply they were absent; they were on approved leave.
    expect(res.json().students.every((s: { percentage: null }) => s.percentage === null)).toBe(true)
  })

  it('rejects a reversed date range', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/attendance/report?sectionId=${fixture.sectionA}&from=${DAY_2}&to=${DAY}`,
      headers: { cookie: adminCookie },
    })
    expect(res.statusCode).toBe(400)
  })
})
