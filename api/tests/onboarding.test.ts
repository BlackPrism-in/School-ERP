import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, db } from '../src/db/client.js'
import { createUser, login, makeApp, resetSchool, type Fixture } from './helpers.js'

let app: FastifyInstance
let fixture: Fixture
let adminCookie: string

beforeAll(async () => {
  fixture = await resetSchool()
  await createUser({ tenantId: fixture.tenantId, email: 'admin@test.school', role: 'admin' })
  await createUser({ tenantId: fixture.tenantId, email: 'teacher@test.school', role: 'teacher' })
  app = await makeApp()
  adminCookie = await login(app, 'admin@test.school')
})

afterAll(async () => {
  await app.close()
  await closeDb()
})

beforeEach(async () => {
  await db()`delete from student_guardian`
  await db()`delete from consent_record`
  await db()`delete from guardian`
  await db()`delete from enrolment`
  await db()`delete from student`
})

function importRows(rows: Record<string, unknown>[], dryRun = true) {
  return app.inject({
    method: 'POST',
    url: '/students/import',
    headers: { cookie: adminCookie },
    payload: { dryRun, rows },
  })
}

/**
 * Bulk import is the Phase 3 exit criterion: a term of the school's real data,
 * from their spreadsheet, reconciling against their records.
 */
describe('bulk import', () => {
  const good = [
    { admissionNo: 'IMP-1', firstName: 'Aarav', lastName: 'Mehta', dateOfBirth: '2011-06-14', gender: 'M', className: 'Grade 10', sectionName: 'A', rollNo: '1' },
    { admissionNo: 'IMP-2', firstName: 'Diya', lastName: 'Kapoor', dateOfBirth: '15/07/2011', gender: 'Female', className: 'Grade 10', sectionName: 'B', rollNo: '2' },
  ]

  it('validates without writing anything on a dry run', async () => {
    const res = await importRows(good, true)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ dryRun: true, imported: 0 })
    expect(res.json().problems).toHaveLength(0)
    expect(res.json().summary.validRows).toBe(2)

    expect(await db()`select 1 from student`).toHaveLength(0)
  })

  it('accepts the date formats a school spreadsheet actually contains', async () => {
    await importRows(good, false)
    const rows = await db()<{ admission_no: string; date_of_birth: Date; gender: string }[]>`
      select admission_no, date_of_birth, gender from student order by admission_no
    `
    expect(rows[0]!.date_of_birth.toISOString().slice(0, 10)).toBe('2011-06-14')
    // dd/mm/yyyy, which is what an Indian school's export produces.
    expect(rows[1]!.date_of_birth.toISOString().slice(0, 10)).toBe('2011-07-15')
    expect(rows[0]!.gender).toBe('male')
    expect(rows[1]!.gender).toBe('female')
  })

  it('enrols into the named class and section', async () => {
    await importRows(good, false)
    const rows = await db()<{ admission_no: string; section_name: string }[]>`
      select st.admission_no, sec.name as section_name
        from student st join enrolment e on e.student_id = st.id
        join section sec on sec.id = e.section_id
       order by st.admission_no
    `
    expect(rows.map((r) => r.section_name)).toEqual(['A', 'B'])
  })

  it('creates the guardian and links them as primary contact', async () => {
    await importRows(
      [{ ...good[0]!, guardianName: 'Priya Mehta', guardianPhone: '9990001111', guardianRelation: 'mother' }],
      false,
    )
    const [row] = await db()<{ first_name: string; relation: string; is_primary_contact: boolean }[]>`
      select g.first_name, sg.relation, sg.is_primary_contact
        from guardian g join student_guardian sg on sg.guardian_id = g.id
    `
    expect(row!.first_name).toBe('Priya Mehta')
    expect(row!.relation).toBe('mother')
    expect(row!.is_primary_contact).toBe(true)
  })

  /**
   * The central rule: a partial import leaves an office unable to tell which
   * of 400 rows landed, and re-running duplicates whatever did.
   */
  it('writes nothing at all when any row is invalid', async () => {
    const res = await importRows(
      [good[0]!, { admissionNo: 'IMP-BAD', firstName: '', className: 'Grade 99' }],
      false,
    )

    expect(res.json().imported).toBe(0)
    expect(res.json().problems.length).toBeGreaterThan(0)
    // Not even the valid first row.
    expect(await db()`select 1 from student`).toHaveLength(0)
  })

  it('reports the row number and field for each problem', async () => {
    const res = await importRows([
      { admissionNo: 'IMP-X', firstName: 'Ok', dateOfBirth: 'not a date' },
    ])
    const problem = res.json().problems[0]
    // Row 2, because row 1 is the spreadsheet's header.
    expect(problem.row).toBe(2)
    expect(problem.field).toBe('dateOfBirth')
  })

  it('catches duplicates within the file, not just against the database', async () => {
    const res = await importRows([
      { admissionNo: 'SAME', firstName: 'First' },
      { admissionNo: 'SAME', firstName: 'Second' },
    ])
    expect(res.json().problems.some((p: { message: string }) => p.message.includes('Duplicate of row 2'))).toBe(true)
  })

  it('catches an admission number already in the school', async () => {
    await importRows([{ admissionNo: 'EXIST-1', firstName: 'Already' }], false)
    const res = await importRows([{ admissionNo: 'EXIST-1', firstName: 'Again' }])
    expect(res.json().problems[0].message).toContain('already exists')
  })

  it('names the class it could not find', async () => {
    const res = await importRows([{ admissionNo: 'IMP-C', firstName: 'X', className: 'Grade 42' }])
    expect(res.json().problems[0].message).toContain('Grade 42')
  })

  it('refuses import without student.import', async () => {
    const cookie = await login(app, 'teacher@test.school')
    const res = await app.inject({
      method: 'POST',
      url: '/students/import',
      headers: { cookie },
      payload: { dryRun: true, rows: [{ admissionNo: 'X', firstName: 'Y' }] },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('guardians and consent', () => {
  async function makeStudent(admissionNo = 'G-1') {
    const res = await app.inject({
      method: 'POST', url: '/students', headers: { cookie: adminCookie },
      payload: { admissionNo, firstName: 'Ward' },
    })
    return res.json().id as string
  }

  it('links a guardian and enforces a single primary contact', async () => {
    const studentId = await makeStudent()

    await app.inject({
      method: 'POST', url: `/students/${studentId}/guardians`, headers: { cookie: adminCookie },
      payload: { firstName: 'Priya', phone: '9990001111', relation: 'mother', isPrimaryContact: true },
    })
    await app.inject({
      method: 'POST', url: `/students/${studentId}/guardians`, headers: { cookie: adminCookie },
      payload: { firstName: 'Rohit', phone: '9990002222', relation: 'father', isPrimaryContact: true },
    })

    const res = await app.inject({
      method: 'GET', url: `/students/${studentId}/guardians`, headers: { cookie: adminCookie },
    })
    const primaries = res.json().data.filter((g: { isPrimaryContact: boolean }) => g.isPrimaryContact)
    expect(primaries).toHaveLength(1)
    expect(primaries[0].firstName).toBe('Rohit')
  })

  /** Siblings share a parent; two records of the same person is a data-quality bug. */
  it('reuses an existing guardian on a phone match', async () => {
    const first = await makeStudent('G-SIB-1')
    const second = await makeStudent('G-SIB-2')
    const payload = { firstName: 'Priya', phone: '9998887777', relation: 'mother' as const }

    await app.inject({ method: 'POST', url: `/students/${first}/guardians`, headers: { cookie: adminCookie }, payload })
    const res = await app.inject({ method: 'POST', url: `/students/${second}/guardians`, headers: { cookie: adminCookie }, payload })

    expect(res.json().reusedExisting).toBe(true)
    expect(await db()`select 1 from guardian where phone = '9998887777'`).toHaveLength(1)
  })

  it('refuses to record consent with no guardian to attribute it to', async () => {
    const studentId = await makeStudent('G-NOCONSENT')
    const res = await app.inject({
      method: 'POST', url: `/students/${studentId}/consent`, headers: { cookie: adminCookie },
      payload: { purpose: 'photography', isGranted: true },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('no_consent_giver')
  })

  it('records granted consent against the guardian and the notice version', async () => {
    const studentId = await makeStudent('G-CONSENT')
    await app.inject({
      method: 'POST', url: `/students/${studentId}/guardians`, headers: { cookie: adminCookie },
      payload: { firstName: 'Priya', phone: '9990003333', relation: 'mother', isConsentGiver: true },
    })

    const res = await app.inject({
      method: 'POST', url: `/students/${studentId}/consent`, headers: { cookie: adminCookie },
      payload: { purpose: 'photography', isGranted: true, noticeVersion: 'v2' },
    })
    expect(res.statusCode).toBe(201)

    const view = await app.inject({
      method: 'GET', url: `/students/${studentId}/consent`, headers: { cookie: adminCookie },
    })
    expect(view.json().data[0]).toMatchObject({
      purpose: 'photography', isGranted: true, noticeVersion: 'v2', guardianName: 'Priya',
    })
  })

  /** Withdrawal must be as easy as granting, and must be recorded. */
  it('records a withdrawal without needing a guardian re-supplied', async () => {
    const studentId = await makeStudent('G-WITHDRAW')
    const res = await app.inject({
      method: 'POST', url: `/students/${studentId}/consent`, headers: { cookie: adminCookie },
      payload: { purpose: 'sms_updates', isGranted: false },
    })
    expect(res.statusCode).toBe(201)

    const [row] = await db()<{ withdrawn_at: Date | null }[]>`
      select withdrawn_at from consent_record where purpose = 'sms_updates'
    `
    expect(row!.withdrawn_at).not.toBeNull()
  })
})

describe('promotion', () => {
  let nextSection: string

  beforeEach(async () => {
    // Sections reference the session, so clear them first.
    await db()`
      delete from section
       where session_id in (select id from academic_session where name = '2027-28')
    `
    await db()`delete from academic_session where name = '2027-28'`
    const [session] = await db()<{ id: string }[]>`
      insert into academic_session (tenant_id, name, start_date, end_date, status)
      values (${fixture.tenantId}, '2027-28', '2027-04-01', '2028-03-31', 'planned')
      returning id
    `
    const [section] = await db()<{ id: string }[]>`
      insert into section (tenant_id, branch_id, class_level_id, session_id, name)
      values (${fixture.tenantId}, ${fixture.branchId}, ${fixture.classId}, ${session!.id}, 'A')
      returning id
    `
    nextSection = section!.id
  })

  async function enrolledStudent(admissionNo: string) {
    const res = await app.inject({
      method: 'POST', url: '/students', headers: { cookie: adminCookie },
      payload: { admissionNo, firstName: `P-${admissionNo}` },
    })
    const studentId = res.json().id
    await app.inject({
      method: 'POST', url: `/students/${studentId}/enrolment`, headers: { cookie: adminCookie },
      payload: { sectionId: fixture.sectionA },
    })
    return studentId as string
  }

  it('previews without writing', async () => {
    await enrolledStudent('PROM-1')
    const res = await app.inject({
      method: 'POST', url: '/enrolment/promote/preview', headers: { cookie: adminCookie },
      payload: { fromSectionId: fixture.sectionA, toSectionId: nextSection },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().students).toHaveLength(1)
    expect(res.json().blockers).toHaveLength(0)

    const rows = await db()`select 1 from enrolment`
    expect(rows).toHaveLength(1)
  })

  it('refuses to promote within the same session', async () => {
    await enrolledStudent('PROM-SAME')
    const res = await app.inject({
      method: 'POST', url: '/enrolment/promote', headers: { cookie: adminCookie },
      payload: { fromSectionId: fixture.sectionA, toSectionId: fixture.sectionB },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.message).toContain('next academic session')
  })

  /**
   * The payoff of the enrolment design: last year's attendance stays attached
   * to last year's enrolment and remains correct forever.
   */
  it('creates a new enrolment and leaves the old year intact', async () => {
    const studentId = await enrolledStudent('PROM-2')
    const [oldEnrolment] = await db()<{ id: string }[]>`
      select id from enrolment where student_id = ${studentId}
    `
    await db()`
      insert into attendance_record (tenant_id, session_id, enrolment_id, date, status, marked_by)
      values (${fixture.tenantId}, ${fixture.sessionId}, ${oldEnrolment!.id}, '2026-07-10', 'present',
              (select id from app_user where email = 'admin@test.school'))
    `

    const res = await app.inject({
      method: 'POST', url: '/enrolment/promote', headers: { cookie: adminCookie },
      payload: { fromSectionId: fixture.sectionA, toSectionId: nextSection },
    })
    expect(res.json().promoted).toBe(1)

    const enrolments = await db()<{ id: string; status: string; promoted_to_id: string | null }[]>`
      select id, status, promoted_to_id from enrolment where student_id = ${studentId}
      order by created_at
    `
    expect(enrolments).toHaveLength(2)
    expect(enrolments[0]!.status).toBe('promoted')
    expect(enrolments[0]!.promoted_to_id).toBe(enrolments[1]!.id)

    // Last year's register is untouched and still attached to last year.
    const history = await db()`
      select 1 from attendance_record where enrolment_id = ${oldEnrolment!.id}
    `
    expect(history).toHaveLength(1)
  })

  it('holds back retained students', async () => {
    const stay = await enrolledStudent('PROM-STAY')
    await enrolledStudent('PROM-GO')

    const res = await app.inject({
      method: 'POST', url: '/enrolment/promote', headers: { cookie: adminCookie },
      payload: { fromSectionId: fixture.sectionA, toSectionId: nextSection, retainStudentIds: [stay] },
    })
    expect(res.json()).toMatchObject({ promoted: 1, retained: 1 })

    const [retained] = await db()<{ status: string }[]>`
      select status from enrolment where student_id = ${stay}
    `
    expect(retained!.status).toBe('retained')
    expect(await db()`select 1 from enrolment where student_id = ${stay}`).toHaveLength(1)
  })

  it('blocks promotion that would overfill the target', async () => {
    await db()`update section set capacity = 1 where id = ${nextSection}`
    await enrolledStudent('PROM-A')
    await enrolledStudent('PROM-B')

    const res = await app.inject({
      method: 'POST', url: '/enrolment/promote', headers: { cookie: adminCookie },
      payload: { fromSectionId: fixture.sectionA, toSectionId: nextSection },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.message).toContain('will not fit')
  })

  it('blocks a second promotion of the same cohort', async () => {
    await enrolledStudent('PROM-TWICE')
    await app.inject({
      method: 'POST', url: '/enrolment/promote', headers: { cookie: adminCookie },
      payload: { fromSectionId: fixture.sectionA, toSectionId: nextSection },
    })

    // Re-enrol them into the old section, then try again.
    const [student] = await db()<{ id: string }[]>`select id from student where admission_no = 'PROM-TWICE'`
    await db()`
      update enrolment set status = 'enrolled', promoted_to_id = null
       where student_id = ${student!.id} and session_id = ${fixture.sessionId}
    `

    const res = await app.inject({
      method: 'POST', url: '/enrolment/promote', headers: { cookie: adminCookie },
      payload: { fromSectionId: fixture.sectionA, toSectionId: nextSection },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.message).toContain('already enrolled')
  })
})
