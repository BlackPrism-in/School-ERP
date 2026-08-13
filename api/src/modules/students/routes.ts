import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { assertStudentInScope } from '../../rbac/scope.js'
import { writeAudit } from '../../lib/audit.js'
import { conflict, notFound } from '../../lib/errors.js'

const genders = ['male', 'female', 'other', 'undisclosed'] as const

const studentInput = z.object({
  admissionNo: z.string().trim().min(1).max(40),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).optional(),
  dateOfBirth: z.string().date().optional(),
  gender: z.enum(genders).optional(),
  bloodGroup: z.string().trim().max(8).optional(),
  category: z.string().trim().max(40).optional(),
  addressLine: z.string().trim().max(300).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  postalCode: z.string().trim().max(16).optional(),
  admissionDate: z.string().date().optional(),
  medicalNotes: z.string().trim().max(2000).optional(),
})

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'transferred', 'withdrawn', 'alumni']).optional(),
  sectionId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

/** Medical notes are sensitive under DPDP — only returned to callers who may see them. */
function present(row: Record<string, unknown>, includeSensitive: boolean) {
  const { medical_notes, ...rest } = row
  return includeSensitive ? { ...rest, medicalNotes: medical_notes } : rest
}

export async function studentRoutes(app: FastifyInstance) {
  /** GET /students — scoped list. A teacher sees only their own sections. */
  app.get('/students', async (request) => {
    const principal = request.require('student.read')
    const query = listQuery.parse(request.query)
    const offset = (query.page - 1) * query.pageSize

    return request.tx(async (tx) => {
      // Scope is applied as a SQL predicate rather than filtering in JS, so
      // pagination counts are correct for what the caller may actually see.
      const scopeClause =
        principal.scope.kind === 'all'
          ? tx`true`
          : principal.scope.kind === 'sections'
            ? principal.scope.sectionIds.length
              ? tx`e.section_id in ${tx(principal.scope.sectionIds)}`
              : tx`false`
            : principal.scope.enrolmentIds.length
              ? tx`e.id in ${tx(principal.scope.enrolmentIds)}`
              : tx`false`

      const search = query.q ? `%${query.q}%` : null

      const rows = await tx<Record<string, unknown>[]>`
        select s.id, s.admission_no as "admissionNo", s.first_name as "firstName",
               s.last_name as "lastName", s.date_of_birth as "dateOfBirth",
               s.gender, s.status, s.admission_date as "admissionDate",
               e.roll_no as "rollNo", sec.name as "sectionName", cl.name as "className",
               count(*) over () as "totalCount"
          from student s
          left join enrolment e
            on e.student_id = s.id
           and e.session_id = (select id from academic_session where is_current limit 1)
          left join section sec on sec.id = e.section_id
          left join class_level cl on cl.id = e.class_level_id
         where s.deleted_at is null
           and ${scopeClause}
           and ${query.status ? tx`s.status = ${query.status}` : tx`true`}
           and ${query.sectionId ? tx`e.section_id = ${query.sectionId}` : tx`true`}
           and ${
             search
               ? tx`(s.first_name ilike ${search} or s.last_name ilike ${search} or s.admission_no ilike ${search})`
               : tx`true`
           }
         order by s.last_name nulls last, s.first_name
         limit ${query.pageSize} offset ${offset}
      `

      const total = rows.length ? Number(rows[0]!.totalCount) : 0
      return {
        data: rows.map(({ totalCount, ...r }) => r),
        page: query.page,
        pageSize: query.pageSize,
        total,
      }
    })
  })

  app.get('/students/:id', async (request) => {
    const principal = request.require('student.read')
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const canSeeSensitive = principal.permissions.has('student.write')

    return request.tx(async (tx) => {
      await assertStudentInScope(tx, principal.scope, id)

      const rows = await tx<Record<string, unknown>[]>`
        select s.id, s.admission_no as "admissionNo", s.first_name as "firstName",
               s.last_name as "lastName", s.date_of_birth as "dateOfBirth", s.gender,
               s.blood_group as "bloodGroup", s.category, s.address_line as "addressLine",
               s.city, s.state, s.postal_code as "postalCode",
               s.admission_date as "admissionDate", s.status, s.medical_notes
          from student s
         where s.id = ${id} and s.deleted_at is null
      `
      const row = rows[0]
      if (!row) throw notFound('No such student.')

      // DPDP: a school must be able to say who looked at a child's sensitive
      // data. Postgres has no SELECT trigger, so the read is logged here.
      if (canSeeSensitive && row.medical_notes) {
        await writeAudit(tx, {
          action: 'sensitive_read',
          entityType: 'student',
          entityId: id,
          actorUserId: principal.user.userId,
          actorLabel: principal.user.displayName,
          detail: { fields: ['medical_notes'] },
          ip: request.ip,
          requestId: request.id,
        })
      }

      return present(row, canSeeSensitive)
    })
  })

  /**
   * POST /students — the Phase 1 exit criterion: an authorised admin creates
   * a student, it persists, and the audit trigger records the write.
   */
  app.post('/students', async (request, reply) => {
    const principal = request.require('student.write')
    const body = studentInput.parse(request.body)

    const created = await request.tx(async (tx) => {
      const existing = await tx<{ id: string }[]>`
        select id from student
         where admission_no = ${body.admissionNo} and deleted_at is null
      `
      if (existing.length) {
        throw conflict(`Admission number ${body.admissionNo} is already in use.`, 'duplicate_admission_no')
      }

      const rows = await tx<{ id: string; admission_no: string }[]>`
        insert into student (tenant_id, admission_no, first_name, last_name, date_of_birth,
                             gender, blood_group, category, address_line, city, state,
                             postal_code, admission_date, medical_notes)
        values (app_current_tenant(), ${body.admissionNo}, ${body.firstName},
                ${body.lastName ?? null}, ${body.dateOfBirth ?? null}, ${body.gender ?? null},
                ${body.bloodGroup ?? null}, ${body.category ?? null}, ${body.addressLine ?? null},
                ${body.city ?? null}, ${body.state ?? null}, ${body.postalCode ?? null},
                ${body.admissionDate ?? null}, ${body.medicalNotes ?? null})
        returning id, admission_no
      `
      return rows[0]!
    })

    reply.code(201)
    return { id: created.id, admissionNo: created.admission_no }
  })

  app.patch('/students/:id', async (request) => {
    const principal = request.require('student.write')
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = studentInput.partial().parse(request.body)

    if (Object.keys(body).length === 0) return { id, updated: false }

    return request.tx(async (tx) => {
      await assertStudentInScope(tx, principal.scope, id)

      const patch: Record<string, unknown> = {}
      if (body.admissionNo !== undefined) patch.admission_no = body.admissionNo
      if (body.firstName !== undefined) patch.first_name = body.firstName
      if (body.lastName !== undefined) patch.last_name = body.lastName
      if (body.dateOfBirth !== undefined) patch.date_of_birth = body.dateOfBirth
      if (body.gender !== undefined) patch.gender = body.gender
      if (body.bloodGroup !== undefined) patch.blood_group = body.bloodGroup
      if (body.category !== undefined) patch.category = body.category
      if (body.addressLine !== undefined) patch.address_line = body.addressLine
      if (body.city !== undefined) patch.city = body.city
      if (body.state !== undefined) patch.state = body.state
      if (body.postalCode !== undefined) patch.postal_code = body.postalCode
      if (body.admissionDate !== undefined) patch.admission_date = body.admissionDate
      if (body.medicalNotes !== undefined) patch.medical_notes = body.medicalNotes

      const rows = await tx<{ id: string }[]>`
        update student set ${tx(patch)} where id = ${id} and deleted_at is null returning id
      `
      if (!rows.length) throw notFound('No such student.')
      return { id, updated: true }
    })
  })

  /**
   * Withdrawal, not deletion. A student's fee and mark history must survive
   * them leaving the school, so this is a status change plus a soft delete.
   */
  app.delete('/students/:id', async (request) => {
    const principal = request.require('student.delete')
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    return request.tx(async (tx) => {
      await assertStudentInScope(tx, principal.scope, id)
      const rows = await tx<{ id: string }[]>`
        update student set status = 'withdrawn', deleted_at = now()
         where id = ${id} and deleted_at is null returning id
      `
      if (!rows.length) throw notFound('No such student.')
      return { id, status: 'withdrawn' }
    })
  })
}
