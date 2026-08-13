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
    employeeNo: 'EMP-100',
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

/**
 * The Phase 1 exit criterion, stated in PRODUCTION-PLAN.md:
 * "a student can be created via API by an authorised admin, persisted in
 * Postgres, and the write appears in the audit log."
 */
describe('Phase 1 exit criterion', () => {
  it('creates a student, persists it, and audits the write', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/students',
      headers: { cookie: adminCookie },
      payload: {
        admissionNo: 'ADM-2026-001',
        firstName: 'Aarav',
        lastName: 'Mehta',
        dateOfBirth: '2011-06-14',
        gender: 'male',
        admissionDate: '2026-04-05',
      },
    })

    expect(res.statusCode).toBe(201)
    const { id } = res.json()

    // Persisted.
    const [row] = await db()<{ admission_no: string; first_name: string; tenant_id: string }[]>`
      select admission_no, first_name, tenant_id from student where id = ${id}
    `
    expect(row!.admission_no).toBe('ADM-2026-001')
    expect(row!.first_name).toBe('Aarav')
    expect(row!.tenant_id).toBe(fixture.tenantId)

    // Audited by the trigger from migration 0009 — with the acting user
    // attributed, which is what the SET LOCAL app.user_id contract buys us.
    const [audit] = await db()<
      { action: string; entity_id: string; after_data: Record<string, unknown>; actor_user_id: string | null }[]
    >`
      select action, entity_id, after_data, actor_user_id
        from audit_log
       where entity_type = 'student' and entity_id = ${id} and action = 'insert'
    `
    expect(audit).toBeDefined()
    expect(audit!.after_data.admission_no).toBe('ADM-2026-001')
    expect(audit!.actor_user_id).not.toBeNull()
  })

  it('records before and after state on update', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/students',
      headers: { cookie: adminCookie },
      payload: { admissionNo: 'ADM-2026-002', firstName: 'Diya' },
    })
    const { id } = created.json()

    await app.inject({
      method: 'PATCH',
      url: `/students/${id}`,
      headers: { cookie: adminCookie },
      payload: { firstName: 'Diya', lastName: 'Kapoor' },
    })

    const [audit] = await db()<
      { before_data: Record<string, unknown>; after_data: Record<string, unknown> }[]
    >`
      select before_data, after_data from audit_log
       where entity_type = 'student' and entity_id = ${id} and action = 'update'
    `
    expect(audit!.before_data.last_name).toBeNull()
    expect(audit!.after_data.last_name).toBe('Kapoor')
  })
})

describe('validation and conflicts', () => {
  it('rejects a duplicate admission number with 409', async () => {
    const payload = { admissionNo: 'ADM-DUP', firstName: 'First' }
    const first = await app.inject({
      method: 'POST',
      url: '/students',
      headers: { cookie: adminCookie },
      payload,
    })
    expect(first.statusCode).toBe(201)

    const second = await app.inject({
      method: 'POST',
      url: '/students',
      headers: { cookie: adminCookie },
      payload: { ...payload, firstName: 'Second' },
    })
    expect(second.statusCode).toBe(409)
    expect(second.json().error.code).toBe('duplicate_admission_no')
  })

  it('reports field-level validation errors', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/students',
      headers: { cookie: adminCookie },
      payload: { admissionNo: '', firstName: '', dateOfBirth: 'not-a-date' },
    })
    expect(res.statusCode).toBe(400)
    const fields = res.json().error.fields.map((f: { path: string }) => f.path)
    expect(fields).toContain('admissionNo')
    expect(fields).toContain('firstName')
    expect(fields).toContain('dateOfBirth')
  })

  it('never leaks SQL or constraint names to the client', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/students',
      headers: { cookie: adminCookie },
      payload: { admissionNo: 'ADM-X', firstName: 'X', gender: 'not-a-gender' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.body).not.toMatch(/constraint|pg_|select |insert into/i)
  })
})

describe('sensitive data handling', () => {
  it('hides medical notes from a reader who cannot edit, and logs a read for one who can', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/students',
      headers: { cookie: adminCookie },
      payload: {
        admissionNo: 'ADM-MED',
        firstName: 'Ishaan',
        medicalNotes: 'Severe peanut allergy — EpiPen in the office.',
      },
    })
    const { id } = created.json()

    // Put this student in the teacher's section so scope allows the read.
    await db()`
      insert into enrolment (tenant_id, student_id, session_id, branch_id, class_level_id, section_id)
      values (${fixture.tenantId}, ${id}, ${fixture.sessionId}, ${fixture.branchId},
              ${fixture.classId}, ${fixture.sectionA})
    `

    const teacherCookie = await login(app, 'teacher@test.school')
    const asTeacher = await app.inject({
      method: 'GET',
      url: `/students/${id}`,
      headers: { cookie: teacherCookie },
    })
    expect(asTeacher.statusCode).toBe(200)
    expect(asTeacher.json().medicalNotes).toBeUndefined()
    expect(asTeacher.body).not.toContain('peanut')

    const asAdmin = await app.inject({
      method: 'GET',
      url: `/students/${id}`,
      headers: { cookie: adminCookie },
    })
    expect(asAdmin.json().medicalNotes).toContain('peanut')

    // DPDP: the school must be able to say who looked at it.
    const reads = await db()<{ actor_user_id: string }[]>`
      select actor_user_id from audit_log
       where entity_type = 'student' and entity_id = ${id} and action = 'sensitive_read'
    `
    expect(reads).toHaveLength(1)
  })
})

describe('withdrawal', () => {
  it('withdraws rather than deletes, preserving history', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/students',
      headers: { cookie: adminCookie },
      payload: { admissionNo: 'ADM-LEAVE', firstName: 'Leaving' },
    })
    const { id } = created.json()

    const res = await app.inject({
      method: 'DELETE',
      url: `/students/${id}`,
      headers: { cookie: adminCookie },
    })
    expect(res.statusCode).toBe(200)

    // The row survives — fee and mark history must outlive the student.
    const [row] = await db()<{ status: string; deleted_at: Date | null }[]>`
      select status, deleted_at from student where id = ${id}
    `
    expect(row!.status).toBe('withdrawn')
    expect(row!.deleted_at).not.toBeNull()

    // But it no longer appears in the roster.
    const list = await app.inject({
      method: 'GET',
      url: '/students?q=Leaving',
      headers: { cookie: adminCookie },
    })
    expect(list.json().total).toBe(0)
  })
})

describe('search and pagination', () => {
  it('filters by name fragment', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/students?q=Aarav',
      headers: { cookie: adminCookie },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.every((s: { firstName: string }) => s.firstName.includes('Aarav'))).toBe(true)
  })

  it('caps page size so a caller cannot pull the whole school in one request', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/students?pageSize=5000',
      headers: { cookie: adminCookie },
    })
    expect(res.statusCode).toBe(400)
  })
})
