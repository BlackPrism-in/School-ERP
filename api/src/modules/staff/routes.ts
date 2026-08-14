import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { hashPassword } from '../../auth/password.js'
import { randomBytes } from 'node:crypto'
import { conflict, notFound, badRequest } from '../../lib/errors.js'
import { ROLE_KEYS } from '../../rbac/permissions.js'
import { accountCreatedMail, sendMail } from '../../lib/mailer.js'

const staffInput = z.object({
  employeeNo: z.string().trim().min(1).max(40),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).optional(),
  dateOfBirth: z.string().date().optional(),
  gender: z.enum(['male', 'female', 'other', 'undisclosed']).optional(),
  designation: z.string().trim().max(80).optional(),
  department: z.string().trim().max(80).optional(),
  isTeaching: z.boolean().default(true),
  phone: z.string().trim().max(20).optional(),
  email: z.string().email().max(254).optional(),
  joinDate: z.string().date().optional(),
  employmentType: z.enum(['permanent', 'contract', 'part_time', 'visiting']).optional(),
})

/**
 * Staff records, their login accounts, and which classes they teach.
 *
 * `staff` and `app_user` are deliberately separate: a school has staff who
 * never sign in (support staff, visiting faculty) and accounts that belong to
 * nobody on the payroll (the shared office login a school insists on having).
 * Linking them is an explicit act.
 */
export async function staffRoutes(app: FastifyInstance) {
  app.get('/staff', async (request) => {
    request.require('staff.read')
    const query = z
      .object({
        q: z.string().trim().max(120).optional(),
        status: z.enum(['active', 'on_leave', 'resigned', 'terminated']).optional(),
        teachingOnly: z.coerce.boolean().optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
      })
      .parse(request.query)

    return request.tx(async (tx) => {
      const search = query.q ? `%${query.q}%` : null
      const rows = await tx<Record<string, unknown>[]>`
        select st.id, st.employee_no as "employeeNo", st.first_name as "firstName",
               st.last_name as "lastName", st.designation, st.department,
               st.is_teaching as "isTeaching", st.status, st.phone, st.email,
               st.join_date as "joinDate",
               (st.user_id is not null) as "hasAccount",
               count(distinct ta.section_id) as "sectionCount",
               count(*) over () as "totalCount"
          from staff st
          left join teaching_assignment ta on ta.staff_id = st.id
         where st.deleted_at is null
           and ${query.status ? tx`st.status = ${query.status}` : tx`true`}
           and ${query.teachingOnly ? tx`st.is_teaching` : tx`true`}
           and ${
             search
               ? tx`(st.first_name ilike ${search} or st.last_name ilike ${search}
                     or st.employee_no ilike ${search} or st.designation ilike ${search})`
               : tx`true`
           }
         group by st.id
         order by st.first_name, st.last_name
         limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}
      `
      const total = rows.length ? Number(rows[0]!.totalCount) : 0
      return {
        data: rows.map(({ totalCount, sectionCount, ...r }) => ({
          ...r,
          sectionCount: Number(sectionCount),
        })),
        page: query.page,
        pageSize: query.pageSize,
        total,
      }
    })
  })

  app.get('/staff/:id', async (request) => {
    request.require('staff.read')
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    return request.tx(async (tx) => {
      const [staff] = await tx<Record<string, unknown>[]>`
        select st.id, st.employee_no as "employeeNo", st.first_name as "firstName",
               st.last_name as "lastName", st.date_of_birth as "dateOfBirth", st.gender,
               st.designation, st.department, st.is_teaching as "isTeaching",
               st.phone, st.email, st.join_date as "joinDate", st.exit_date as "exitDate",
               st.employment_type as "employmentType", st.status,
               st.user_id as "userId", u.email as "accountEmail", u.status as "accountStatus"
          from staff st
          left join app_user u on u.id = st.user_id
         where st.id = ${id} and st.deleted_at is null
      `
      if (!staff) throw notFound('No such staff member.')

      const assignments = await tx<Record<string, unknown>[]>`
        select ta.id, ta.section_id as "sectionId", sec.name as "sectionName",
               cl.name as "className", sub.name as "subjectName", ta.subject_id as "subjectId"
          from teaching_assignment ta
          join section sec on sec.id = ta.section_id
          join class_level cl on cl.id = sec.class_level_id
          join subject sub on sub.id = ta.subject_id
          join academic_session s on s.id = ta.session_id and s.is_current
         where ta.staff_id = ${id}
         order by cl.sort_order, sec.name, sub.name
      `

      const classTeacherOf = await tx<Record<string, unknown>[]>`
        select sec.id, sec.name, cl.name as "className"
          from section sec
          join class_level cl on cl.id = sec.class_level_id
          join academic_session s on s.id = sec.session_id and s.is_current
         where sec.class_teacher_id = ${id} and sec.deleted_at is null
      `

      return { ...staff, assignments, classTeacherOf }
    })
  })

  app.post('/staff', async (request, reply) => {
    request.require('staff.write')
    const body = staffInput.parse(request.body)

    return request.tx(async (tx) => {
      const existing = await tx`
        select 1 from staff where employee_no = ${body.employeeNo} and deleted_at is null
      `
      if (existing.length) {
        throw conflict(`Employee number ${body.employeeNo} is already in use.`, 'duplicate_employee_no')
      }

      const [branch] = await tx<{ id: string }[]>`
        select id from branch where is_primary and deleted_at is null limit 1
      `

      const rows = await tx<{ id: string }[]>`
        insert into staff (tenant_id, branch_id, employee_no, first_name, last_name,
                           date_of_birth, gender, designation, department, is_teaching,
                           phone, email, join_date, employment_type)
        values (app_current_tenant(), ${branch?.id ?? null}, ${body.employeeNo},
                ${body.firstName}, ${body.lastName ?? null}, ${body.dateOfBirth ?? null},
                ${body.gender ?? null}, ${body.designation ?? null}, ${body.department ?? null},
                ${body.isTeaching}, ${body.phone ?? null}, ${body.email ?? null},
                ${body.joinDate ?? null}, ${body.employmentType ?? 'permanent'})
        returning id
      `
      reply.code(201)
      return { id: rows[0]!.id }
    })
  })

  app.patch('/staff/:id', async (request) => {
    request.require('staff.write')
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = staffInput.partial().parse(request.body)

    if (Object.keys(body).length === 0) return { id, updated: false }

    return request.tx(async (tx) => {
      const patch: Record<string, unknown> = {}
      const map: Record<string, string> = {
        employeeNo: 'employee_no', firstName: 'first_name', lastName: 'last_name',
        dateOfBirth: 'date_of_birth', gender: 'gender', designation: 'designation',
        department: 'department', isTeaching: 'is_teaching', phone: 'phone',
        email: 'email', joinDate: 'join_date', employmentType: 'employment_type',
      }
      for (const [key, column] of Object.entries(map)) {
        if (body[key as keyof typeof body] !== undefined) patch[column] = body[key as keyof typeof body]
      }

      const rows = await tx<{ id: string }[]>`
        update staff set ${tx(patch)} where id = ${id} and deleted_at is null returning id
      `
      if (!rows.length) throw notFound('No such staff member.')
      return { id, updated: true }
    })
  })

  /**
   * Resignation, not deletion. Their attendance marks, the registers they
   * signed and the marks they entered all reference this row.
   */
  app.delete('/staff/:id', async (request) => {
    request.require('staff.write')
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z.object({ exitDate: z.string().date().optional() }).parse(request.body ?? {})

    return request.tx(async (tx) => {
      const [assignments] = await tx<{ n: string }[]>`
        select count(*) as n from teaching_assignment ta
          join academic_session s on s.id = ta.session_id and s.is_current
         where ta.staff_id = ${id}
      `
      if (Number(assignments!.n) > 0) {
        throw conflict(
          `They are still assigned to ${assignments!.n} class(es) this session. Reassign those first.`,
          'has_assignments',
        )
      }

      const rows = await tx<{ id: string }[]>`
        update staff
           set status = 'resigned', exit_date = ${body.exitDate ?? null}, deleted_at = now()
         where id = ${id} and deleted_at is null
        returning id, user_id
      `
      if (!rows.length) throw notFound('No such staff member.')

      // Their login must stop working the day they leave.
      await tx`
        update app_user set status = 'disabled'
         where id = (select user_id from staff where id = ${id}) and status = 'active'
      `
      await tx`delete from user_session where user_id = (select user_id from staff where id = ${id})`

      return { id, status: 'resigned' }
    })
  })

  // ------------------------------------------------------------- accounts

  app.post('/staff/:id/account', async (request, reply) => {
    request.require('user.manage')
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z
      .object({
        email: z.string().email().max(254),
        role: z.enum(ROLE_KEYS).refine((r) => r !== 'student' && r !== 'guardian', {
          message: 'Staff accounts cannot take a student or guardian role.',
        }),
      })
      .parse(request.body)

    return request.tx(async (tx) => {
      const [staff] = await tx<{ id: string; user_id: string | null; first_name: string; last_name: string | null }[]>`
        select id, user_id, first_name, last_name from staff where id = ${id} and deleted_at is null
      `
      if (!staff) throw notFound('No such staff member.')
      if (staff.user_id) throw conflict('That staff member already has an account.', 'account_exists')

      const [taken] = await tx<{ id: string }[]>`
        select id from app_user where email = ${body.email} and deleted_at is null
      `
      if (taken) throw conflict('That email address already has an account.', 'email_taken')

      // Generated, shown once, and must be changed at first sign-in — the same
      // rule as the bootstrap admin. No account ever ships with a known password.
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
      const temporary = Array.from(randomBytes(16), (b) => alphabet[b % alphabet.length]).join('')

      const [user] = await tx<{ id: string }[]>`
        insert into app_user (tenant_id, email, password_hash, display_name, must_change_password)
        values (app_current_tenant(), ${body.email}, ${await hashPassword(temporary)},
                ${[staff.first_name, staff.last_name].filter(Boolean).join(' ')}, true)
        returning id
      `
      await tx`
        insert into user_role (user_id, role_id, granted_by)
        select ${user!.id}, id, ${request.principal!.user.userId}
          from role where key = ${body.role}
      `
      await tx`update staff set user_id = ${user!.id} where id = ${id}`

      const [school] = await tx<{ name: string }[]>`
        select name from tenant where id = app_current_tenant()
      `
      // Welcome only — the temporary password is never emailed. It is shown
      // once on screen and handed over directly; an emailed credential sits in
      // a mailbox forever.
      await sendMail(
        accountCreatedMail({
          to: body.email,
          displayName: [staff.first_name, staff.last_name].filter(Boolean).join(' '),
          schoolName: school?.name ?? 'your school',
        }),
        request.log,
      )

      reply.code(201)
      return { userId: user!.id, email: body.email, temporaryPassword: temporary }
    })
  })

  // -------------------------------------------------- teaching assignments

  app.post('/staff/:id/assignments', async (request, reply) => {
    request.require('settings.manage')
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = z
      .object({ sectionId: z.string().uuid(), subjectId: z.string().uuid() })
      .parse(request.body)

    return request.tx(async (tx) => {
      const [staff] = await tx<{ is_teaching: boolean }[]>`
        select is_teaching from staff where id = ${id} and deleted_at is null
      `
      if (!staff) throw notFound('No such staff member.')
      if (!staff.is_teaching) throw badRequest('That staff member is not marked as teaching.')

      const [section] = await tx<{ session_id: string }[]>`
        select session_id from section where id = ${body.sectionId} and deleted_at is null
      `
      if (!section) throw notFound('No such section.')

      const rows = await tx<{ id: string }[]>`
        insert into teaching_assignment (tenant_id, session_id, staff_id, section_id, subject_id)
        values (app_current_tenant(), ${section.session_id}, ${id}, ${body.sectionId}, ${body.subjectId})
        on conflict do nothing
        returning id
      `
      if (!rows.length) throw conflict('That assignment already exists.', 'duplicate_assignment')

      reply.code(201)
      return { id: rows[0]!.id }
    })
  })

  app.delete('/staff/assignments/:assignmentId', async (request) => {
    request.require('settings.manage')
    const { assignmentId } = z.object({ assignmentId: z.string().uuid() }).parse(request.params)

    return request.tx(async (tx) => {
      const rows = await tx<{ id: string }[]>`
        delete from teaching_assignment where id = ${assignmentId} returning id
      `
      if (!rows.length) throw notFound('No such assignment.')
      return { id: assignmentId, removed: true }
    })
  })
}
