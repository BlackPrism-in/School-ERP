import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { conflict, notFound, badRequest } from '../../lib/errors.js'

/**
 * School setup: the structural reference data every operational module hangs
 * off. Sessions, classes, sections and subjects.
 *
 * Reads are open to any signed-in user — these are non-personal lists that
 * populate filters everywhere. Writes require `settings.manage`.
 *
 * Deletes are refused whenever the row is in use. A school that deletes
 * "Grade 10" mid-year and takes its enrolments with it has lost data it cannot
 * reconstruct, so the FKs are `on delete restrict` and this layer turns that
 * into an explanation rather than a 500.
 */
export async function schoolRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------- sessions

  app.get('/school/sessions', async (request) => {
    request.requirePrincipal()
    return request.tx(async (tx) => {
      const rows = await tx<Record<string, unknown>[]>`
        select id, name, start_date as "startDate", end_date as "endDate",
               is_current as "isCurrent", status
          from academic_session
         order by start_date desc
      `
      return { data: rows }
    })
  })

  app.post('/school/sessions', async (request, reply) => {
    request.require('settings.manage')
    const body = z
      .object({
        name: z.string().trim().min(1).max(40),
        startDate: z.string().date(),
        endDate: z.string().date(),
        makeCurrent: z.boolean().default(false),
      })
      .parse(request.body)

    if (body.endDate <= body.startDate) {
      throw badRequest('The session must end after it starts.')
    }

    return request.tx(async (tx) => {
      // Only one session may be current; the partial unique index in
      // migration 0003 would otherwise reject this outright.
      if (body.makeCurrent) {
        await tx`update academic_session set is_current = false where is_current`
      }
      const rows = await tx<{ id: string }[]>`
        insert into academic_session (tenant_id, name, start_date, end_date, is_current, status)
        values (app_current_tenant(), ${body.name}, ${body.startDate}, ${body.endDate},
                ${body.makeCurrent}, ${body.makeCurrent ? 'active' : 'planned'})
        returning id
      `
      reply.code(201)
      return { id: rows[0]!.id }
    })
  })

  // -------------------------------------------------------------- classes

  app.get('/school/classes', async (request) => {
    request.requirePrincipal()
    return request.tx(async (tx) => {
      const rows = await tx<Record<string, unknown>[]>`
        select cl.id, cl.name, cl.code, cl.sort_order as "sortOrder",
               count(distinct sec.id) filter (where sec.deleted_at is null) as "sectionCount"
          from class_level cl
          left join section sec on sec.class_level_id = cl.id
         where cl.deleted_at is null
         group by cl.id
         order by cl.sort_order, cl.name
      `
      return { data: rows.map((r) => ({ ...r, sectionCount: Number(r.sectionCount) })) }
    })
  })

  app.post('/school/classes', async (request, reply) => {
    request.require('settings.manage')
    const body = z
      .object({
        name: z.string().trim().min(1).max(60),
        code: z.string().trim().max(20).optional(),
        sortOrder: z.number().int().min(0).max(1000).default(0),
      })
      .parse(request.body)

    return request.tx(async (tx) => {
      const existing = await tx`
        select 1 from class_level where name = ${body.name} and deleted_at is null
      `
      if (existing.length) throw conflict(`A class called “${body.name}” already exists.`)

      const rows = await tx<{ id: string }[]>`
        insert into class_level (tenant_id, name, code, sort_order)
        values (app_current_tenant(), ${body.name}, ${body.code ?? null}, ${body.sortOrder})
        returning id
      `
      reply.code(201)
      return { id: rows[0]!.id }
    })
  })

  app.delete('/school/classes/:id', async (request) => {
    request.require('settings.manage')
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    return request.tx(async (tx) => {
      const [inUse] = await tx<{ count: string }[]>`
        select count(*) from enrolment where class_level_id = ${id}
      `
      if (Number(inUse!.count) > 0) {
        throw conflict(
          `That class has ${inUse!.count} enrolment(s) and cannot be removed. Its history must stay intact.`,
          'in_use',
        )
      }
      const rows = await tx<{ id: string }[]>`
        update class_level set deleted_at = now() where id = ${id} and deleted_at is null returning id
      `
      if (!rows.length) throw notFound('No such class.')
      return { id, deleted: true }
    })
  })

  // ------------------------------------------------------------- sections

  app.get('/school/sections', async (request) => {
    const principal = request.requirePrincipal()
    const query = z
      .object({ classId: z.string().uuid().optional(), sessionId: z.string().uuid().optional() })
      .parse(request.query)

    return request.tx(async (tx) => {
      // A teacher picking a class to mark should only see their own sections.
      const scopeClause =
        principal.scope.kind === 'sections'
          ? principal.scope.sectionIds.length
            ? tx`sec.id in ${tx(principal.scope.sectionIds)}`
            : tx`false`
          : tx`true`

      const rows = await tx<Record<string, unknown>[]>`
        select sec.id, sec.name, sec.capacity,
               cl.id as "classId", cl.name as "className",
               sec.session_id as "sessionId",
               st.first_name as "classTeacherName",
               count(distinct e.id) as "studentCount"
          from section sec
          join class_level cl on cl.id = sec.class_level_id
          left join staff st on st.id = sec.class_teacher_id
          left join enrolment e on e.section_id = sec.id and e.status = 'enrolled'
         where sec.deleted_at is null
           and sec.session_id = ${
             query.sessionId
               ? tx`${query.sessionId}::uuid`
               : tx`(select id from academic_session where is_current limit 1)`
           }
           and ${query.classId ? tx`sec.class_level_id = ${query.classId}` : tx`true`}
           and ${scopeClause}
         group by sec.id, cl.id, st.first_name
         order by cl.sort_order, cl.name, sec.name
      `
      return { data: rows.map((r) => ({ ...r, studentCount: Number(r.studentCount) })) }
    })
  })

  app.post('/school/sections', async (request, reply) => {
    request.require('settings.manage')
    const body = z
      .object({
        name: z.string().trim().min(1).max(30),
        classId: z.string().uuid(),
        sessionId: z.string().uuid().optional(),
        branchId: z.string().uuid().optional(),
        capacity: z.number().int().positive().max(500).optional(),
        classTeacherId: z.string().uuid().optional(),
      })
      .parse(request.body)

    return request.tx(async (tx) => {
      const [session] = body.sessionId
        ? await tx<{ id: string }[]>`select id from academic_session where id = ${body.sessionId}`
        : await tx<{ id: string }[]>`select id from academic_session where is_current limit 1`
      if (!session) throw badRequest('No current academic session. Create one first.')

      const [branch] = body.branchId
        ? await tx<{ id: string }[]>`select id from branch where id = ${body.branchId} and deleted_at is null`
        : await tx<{ id: string }[]>`select id from branch where is_primary and deleted_at is null limit 1`
      if (!branch) throw badRequest('No branch to attach this section to.')

      const rows = await tx<{ id: string }[]>`
        insert into section (tenant_id, branch_id, class_level_id, session_id, name,
                             capacity, class_teacher_id)
        values (app_current_tenant(), ${branch.id}, ${body.classId}, ${session.id},
                ${body.name}, ${body.capacity ?? null}, ${body.classTeacherId ?? null})
        returning id
      `
      reply.code(201)
      return { id: rows[0]!.id }
    })
  })

  // ------------------------------------------------------------- subjects

  app.get('/school/subjects', async (request) => {
    request.requirePrincipal()
    return request.tx(async (tx) => {
      const rows = await tx<Record<string, unknown>[]>`
        select id, name, code, kind from subject where deleted_at is null order by name
      `
      return { data: rows }
    })
  })

  app.post('/school/subjects', async (request, reply) => {
    request.require('settings.manage')
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        code: z.string().trim().max(20).optional(),
        kind: z.enum(['theory', 'practical', 'both', 'non_academic']).default('theory'),
      })
      .parse(request.body)

    return request.tx(async (tx) => {
      const existing = await tx`select 1 from subject where name = ${body.name} and deleted_at is null`
      if (existing.length) throw conflict(`A subject called “${body.name}” already exists.`)

      const rows = await tx<{ id: string }[]>`
        insert into subject (tenant_id, name, code, kind)
        values (app_current_tenant(), ${body.name}, ${body.code ?? null}, ${body.kind})
        returning id
      `
      reply.code(201)
      return { id: rows[0]!.id }
    })
  })

  // -------------------------------------------------------------- periods

  app.get('/school/periods', async (request) => {
    request.requirePrincipal()
    return request.tx(async (tx) => {
      const rows = await tx<Record<string, unknown>[]>`
        select id, name, start_time as "startTime", end_time as "endTime",
               sort_order as "sortOrder"
          from period order by sort_order, start_time
      `
      return { data: rows }
    })
  })
}
