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

beforeAll(async () => {
  fixture = await resetSchool()
  await createUser({ tenantId: fixture.tenantId, email: 'admin@test.school', role: 'admin' })

  const teacherUser = await createUser({ tenantId: fixture.tenantId, email: 'teacher@test.school', role: 'teacher' })
  const staffId = await createStaff({ tenantId: fixture.tenantId, userId: teacherUser, employeeNo: 'E1', name: 'Maya' })
  await assignTeacher({ fixture, staffId, sectionId: fixture.sectionA })

  pupils = [
    await createStudentWithEnrolment({ fixture, admissionNo: 'X-1', firstName: 'Aarav', sectionId: fixture.sectionA }),
    await createStudentWithEnrolment({ fixture, admissionNo: 'X-2', firstName: 'Diya', sectionId: fixture.sectionA }),
  ]

  // A default grading scheme so publication can assign grades.
  const [scheme] = await db()<{ id: string }[]>`
    insert into grading_scheme (tenant_id, name, is_default)
    values (${fixture.tenantId}, 'Standard', true) returning id
  `
  const bands: [string, number, number, boolean][] = [
    ['A', 80, 100, false], ['B', 60, 79.99, false], ['C', 33, 59.99, false], ['F', 0, 32.99, true],
  ]
  for (const [grade, min, max, failing] of bands) {
    await db()`
      insert into grade_band (tenant_id, grading_scheme_id, grade, min_percent, max_percent, is_failing)
      values (${fixture.tenantId}, ${scheme!.id}, ${grade}, ${min}, ${max}, ${failing})
    `
  }

  app = await makeApp()
  adminCookie = await login(app, 'admin@test.school')
  teacherCookie = await login(app, 'teacher@test.school')
})

afterAll(async () => {
  await app.close()
  await closeDb()
})

beforeEach(async () => {
  await db()`delete from exam_result`
  await db()`delete from mark`
  await db()`delete from exam_subject`
  await db()`delete from exam`
})

async function makeExam(name = 'Term I') {
  const res = await app.inject({
    method: 'POST', url: '/exams', headers: { cookie: adminCookie },
    payload: { name, classLevelId: fixture.classId },
  })
  expect(res.statusCode).toBe(201)
  return res.json().id as string
}

async function addPaper(examId: string, opts: Partial<Record<string, number>> = {}) {
  const res = await app.inject({
    method: 'POST', url: `/exams/${examId}/subjects`, headers: { cookie: adminCookie },
    payload: {
      subjectId: fixture.subjectId,
      theoryMax: opts.theoryMax ?? 80,
      practicalMax: opts.practicalMax ?? 20,
      passMarks: opts.passMarks ?? 33,
    },
  })
  expect(res.statusCode).toBe(201)
  return res.json().id as string
}

async function setStatus(examId: string, status: string, cookie = adminCookie) {
  return app.inject({
    method: 'POST', url: `/exams/${examId}/status`, headers: { cookie }, payload: { status },
  })
}

describe('exam configuration', () => {
  it('rejects a paper with no marks available', async () => {
    const examId = await makeExam()
    const res = await app.inject({
      method: 'POST', url: `/exams/${examId}/subjects`, headers: { cookie: adminCookie },
      payload: { subjectId: fixture.subjectId, theoryMax: 0, practicalMax: 0, objectiveMax: 0 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a pass mark above the paper total', async () => {
    const examId = await makeExam()
    const res = await app.inject({
      method: 'POST', url: `/exams/${examId}/subjects`, headers: { cookie: adminCookie },
      payload: { subjectId: fixture.subjectId, theoryMax: 50, passMarks: 60 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('computes the paper total from its components', async () => {
    const examId = await makeExam()
    await addPaper(examId, { theoryMax: 70, practicalMax: 30 })
    const res = await app.inject({ method: 'GET', url: `/exams/${examId}`, headers: { cookie: adminCookie } })
    expect(Number(res.json().subjects[0].totalMax)).toBe(100)
  })

  it('refuses a teacher creating an exam', async () => {
    const res = await app.inject({
      method: 'POST', url: '/exams', headers: { cookie: teacherCookie },
      payload: { name: 'Sneaky', classLevelId: fixture.classId },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('listing', () => {
  /**
   * The list endpoint had an invalid GROUP BY and returned a 500 for months
   * of development because no test called it — only the E2E journey did.
   */
  it('lists exams with their class and paper count', async () => {
    const examId = await makeExam('Listed Exam')
    await addPaper(examId)

    const res = await app.inject({ method: 'GET', url: '/exams', headers: { cookie: adminCookie } })
    expect(res.statusCode).toBe(200)

    const row = res.json().data.find((e: { name: string }) => e.name === 'Listed Exam')
    expect(row).toBeDefined()
    expect(row.className).toBe('Grade 10')
    expect(row.subjectCount).toBe(1)
  })

  it('hides drafts from a role without exam.configure', async () => {
    await makeExam('Hidden Draft')
    const res = await app.inject({ method: 'GET', url: '/exams', headers: { cookie: teacherCookie } })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.some((e: { name: string }) => e.name === 'Hidden Draft')).toBe(false)
  })
})

describe('state machine', () => {
  it('walks the intended path', async () => {
    const examId = await makeExam()
    await addPaper(examId)

    for (const status of ['scheduled', 'mark_entry']) {
      expect((await setStatus(examId, status)).statusCode).toBe(200)
    }
  })

  it('refuses to skip a step', async () => {
    const examId = await makeExam()
    const res = await setStatus(examId, 'published')
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('invalid_transition')
  })

  it('refuses a teacher moving an exam to moderation', async () => {
    const examId = await makeExam()
    await addPaper(examId)
    await setStatus(examId, 'scheduled')
    await setStatus(examId, 'mark_entry')

    const res = await setStatus(examId, 'moderation', teacherCookie)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.message).toContain('exam.moderate')
  })
})

describe('mark entry', () => {
  async function openForEntry() {
    const examId = await makeExam()
    const paperId = await addPaper(examId)
    await setStatus(examId, 'scheduled')
    await setStatus(examId, 'mark_entry')
    return { examId, paperId }
  }

  async function enterMarks(paperId: string, entries: unknown[], cookie = teacherCookie) {
    return app.inject({
      method: 'POST', url: `/exams/subjects/${paperId}/marks`, headers: { cookie },
      payload: { sectionId: fixture.sectionA, entries },
    })
  }

  it('accepts marks within the maxima and totals them', async () => {
    const { paperId } = await openForEntry()
    const res = await enterMarks(paperId, [
      { enrolmentId: pupils[0]!.enrolmentId, theoryMarks: 68, practicalMarks: 18 },
      { enrolmentId: pupils[1]!.enrolmentId, theoryMarks: 40, practicalMarks: 10 },
    ])
    expect(res.statusCode).toBe(200)

    const [row] = await db()<{ total_marks: string }[]>`
      select total_marks::text from mark where enrolment_id = ${pupils[0]!.enrolmentId}
    `
    expect(Number(row!.total_marks)).toBe(86)
  })

  /** Enforced by the validate_mark trigger, not just by this layer. */
  it('refuses marks above the paper maximum', async () => {
    const { paperId } = await openForEntry()
    const res = await enterMarks(paperId, [
      { enrolmentId: pupils[0]!.enrolmentId, theoryMarks: 95 },
    ])
    expect(res.statusCode).toBe(400)
    expect(await db()`select 1 from mark`).toHaveLength(0)
  })

  it('refuses component marks for an absent student', async () => {
    const { paperId } = await openForEntry()
    const res = await enterMarks(paperId, [
      { enrolmentId: pupils[0]!.enrolmentId, isAbsent: true, theoryMarks: 50 },
    ])
    expect(res.statusCode).toBe(400)
  })

  it('refuses entry before the exam is open', async () => {
    const examId = await makeExam()
    const paperId = await addPaper(examId)
    const res = await enterMarks(paperId, [{ enrolmentId: pupils[0]!.enrolmentId, theoryMarks: 10 }])
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('not_open_for_entry')
  })

  it('refuses a teacher entering marks for another section', async () => {
    const { paperId } = await openForEntry()
    const res = await app.inject({
      method: 'POST', url: `/exams/subjects/${paperId}/marks`, headers: { cookie: teacherCookie },
      payload: { sectionId: fixture.sectionB, entries: [{ enrolmentId: pupils[0]!.enrolmentId, theoryMarks: 10 }] },
    })
    expect(res.statusCode).toBe(403)
  })

  it('rejects an enrolment from a different section', async () => {
    const { paperId } = await openForEntry()
    const outsider = await createStudentWithEnrolment({
      fixture, admissionNo: `X-OUT-${Date.now()}`, firstName: 'Outsider', sectionId: fixture.sectionB,
    })
    const res = await enterMarks(paperId, [
      { enrolmentId: outsider.enrolmentId, theoryMarks: 10 },
    ], adminCookie)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('roster_mismatch')

    // They belong to the same class level, so publication would legitimately
    // demand marks for them too. Remove them so the next test starts clean.
    await db()`delete from enrolment where id = ${outsider.enrolmentId}`
    await db()`delete from student where id = ${outsider.studentId}`
  })
})

describe('publication', () => {
  async function fullyMarked() {
    const examId = await makeExam()
    const paperId = await addPaper(examId)
    await setStatus(examId, 'scheduled')
    await setStatus(examId, 'mark_entry')
    await app.inject({
      method: 'POST', url: `/exams/subjects/${paperId}/marks`, headers: { cookie: adminCookie },
      payload: {
        sectionId: fixture.sectionA,
        entries: [
          { enrolmentId: pupils[0]!.enrolmentId, theoryMarks: 68, practicalMarks: 18 },
          { enrolmentId: pupils[1]!.enrolmentId, theoryMarks: 20, practicalMarks: 5 },
        ],
      },
    })
    await setStatus(examId, 'moderation')
    return examId
  }

  it('refuses to publish while marks are missing', async () => {
    const examId = await makeExam()
    const paperId = await addPaper(examId)
    await setStatus(examId, 'scheduled')
    await setStatus(examId, 'mark_entry')
    await app.inject({
      method: 'POST', url: `/exams/subjects/${paperId}/marks`, headers: { cookie: adminCookie },
      payload: { sectionId: fixture.sectionA, entries: [{ enrolmentId: pupils[0]!.enrolmentId, theoryMarks: 50 }] },
    })
    await setStatus(examId, 'moderation')

    const res = await setStatus(examId, 'published')
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('marks_incomplete')
  })

  it('computes percentage, grade, rank and pass/fail', async () => {
    const examId = await fullyMarked()
    expect((await setStatus(examId, 'published')).statusCode).toBe(200)

    const res = await app.inject({ method: 'GET', url: `/exams/${examId}/results`, headers: { cookie: adminCookie } })
    const byName = Object.fromEntries(res.json().data.map((r: { name: string }) => [r.name.trim(), r]))

    // 86/100 → A, rank 1, pass
    expect(Number(byName.Aarav.percentage)).toBe(86)
    expect(byName.Aarav.grade).toBe('A')
    expect(byName.Aarav.rank).toBe(1)
    expect(byName.Aarav.outcome).toBe('pass')

    // 25/100 is below the 33 pass mark → fail
    expect(byName.Diya.outcome).toBe('fail')
    expect(byName.Diya.rank).toBe(2)
  })

  /**
   * A published result is a snapshot. A report card in a parent's hand must
   * not silently change because someone edited a mark afterwards.
   */
  it('locks marks against further change once locked', async () => {
    const examId = await fullyMarked()
    await setStatus(examId, 'published')
    await setStatus(examId, 'locked')

    await expect(
      db()`update mark set theory_marks = 10
            where exam_subject_id in (select id from exam_subject where exam_id = ${examId})`,
    ).rejects.toThrow(/locked/i)
  })

  it('refuses an admin publishing without exam.publish being checked per hop', async () => {
    // admin does hold exam.publish; assert the negative case with a teacher.
    const examId = await fullyMarked()
    const res = await setStatus(examId, 'published', teacherCookie)
    expect(res.statusCode).toBe(403)
  })
})
