import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Tx } from '../../db/client.js'
import { badRequest, forbidden, notFound } from '../../lib/errors.js'
import type { Principal } from '../../plugins/context.js'

const audienceSchema = z
  .array(
    z.object({
      type: z.enum(['everyone', 'role', 'class_level', 'section', 'student']),
      roleKey: z.string().max(40).optional(),
      classLevelId: z.string().uuid().optional(),
      sectionId: z.string().uuid().optional(),
      studentId: z.string().uuid().optional(),
    }),
  )
  .min(1)
  .max(50)

const noticeInput = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20_000),
  category: z.string().trim().max(40).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  publishAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  audiences: audienceSchema,
})

/**
 * Resolves the set of audience keys that make a notice visible to this user.
 *
 * Computed per request rather than stored, because a student changing section
 * must immediately stop seeing their old class's notices — and a stored
 * subscription list would quietly keep showing them.
 */
async function audienceKeysFor(tx: Tx, principal: Principal) {
  const roleIds = await tx<{ id: string }[]>`
    select r.id from user_role ur join role r on r.id = ur.role_id
     where ur.user_id = ${principal.user.userId}
  `

  // Sections the user belongs to: taught (teacher) or enrolled in
  // (student / guardian's children).
  const rows = await tx<{ section_id: string; class_level_id: string; student_id: string }[]>`
    select distinct e.section_id, e.class_level_id, e.student_id
      from enrolment e
      join academic_session s on s.id = e.session_id and s.is_current
     where e.student_id in (
             select st.id from student st where st.user_id = ${principal.user.userId}
             union
             select sg.student_id from student_guardian sg
               join guardian g on g.id = sg.guardian_id
              where g.user_id = ${principal.user.userId}
           )
    union
    select distinct ta.section_id, sec.class_level_id, null::uuid
      from teaching_assignment ta
      join section sec on sec.id = ta.section_id
      join staff st on st.id = ta.staff_id
      join academic_session s on s.id = ta.session_id and s.is_current
     where st.user_id = ${principal.user.userId}
  `

  return {
    roleIds: roleIds.map((r) => r.id),
    sectionIds: [...new Set(rows.map((r) => r.section_id).filter(Boolean))],
    classIds: [...new Set(rows.map((r) => r.class_level_id).filter(Boolean))],
    studentIds: [...new Set(rows.map((r) => r.student_id).filter(Boolean))],
  }
}

export async function noticeRoutes(app: FastifyInstance) {
  /**
   * GET /notices — the feed. Authors and administrators see everything
   * including drafts; everyone else sees only published notices addressed to
   * them, within their publish/expiry window.
   */
  app.get('/notices', async (request) => {
    const principal = request.require('notice.read')
    const query = z
      .object({
        status: z.enum(['draft', 'published', 'archived']).optional(),
        unreadOnly: z.coerce.boolean().optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(request.query)

    const canManage = principal.permissions.has('notice.write')

    return request.tx(async (tx) => {
      const keys = await audienceKeysFor(tx, principal)

      const visibility = canManage
        ? tx`true`
        : tx`
            n.status = 'published'
            and n.publish_at <= now()
            and (n.expires_at is null or n.expires_at > now())
            and exists (
              select 1 from notice_audience na
               where na.notice_id = n.id
                 and (
                   na.audience_type = 'everyone'
                   or (na.audience_type = 'role' and na.role_id = any(${keys.roleIds}::uuid[]))
                   or (na.audience_type = 'class_level' and na.class_level_id = any(${keys.classIds}::uuid[]))
                   or (na.audience_type = 'section' and na.section_id = any(${keys.sectionIds}::uuid[]))
                   or (na.audience_type = 'student' and na.student_id = any(${keys.studentIds}::uuid[]))
                 )
            )
          `

      const rows = await tx<Record<string, unknown>[]>`
        select n.id, n.title, n.category, n.priority, n.status,
               n.publish_at as "publishAt", n.expires_at as "expiresAt",
               left(n.body, 240) as excerpt,
               length(n.body) > 240 as truncated,
               u.display_name as "createdBy",
               (nr.user_id is not null) as read,
               count(*) over () as "totalCount"
          from notice n
          left join app_user u on u.id = n.created_by
          left join notice_read nr on nr.notice_id = n.id and nr.user_id = ${principal.user.userId}
         where ${query.status ? tx`n.status = ${query.status}` : tx`n.status <> 'archived'`}
           and ${query.unreadOnly ? tx`nr.user_id is null` : tx`true`}
           and ${visibility}
         order by
           case n.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
           n.publish_at desc
         limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}
      `

      return {
        data: rows.map(({ totalCount, ...r }) => r),
        page: query.page,
        pageSize: query.pageSize,
        total: rows.length ? Number(rows[0]!.totalCount) : 0,
      }
    })
  })

  app.get('/notices/:id', async (request) => {
    const principal = request.require('notice.read')
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const canManage = principal.permissions.has('notice.write')

    return request.tx(async (tx) => {
      const [notice] = await tx<Record<string, unknown>[]>`
        select n.id, n.title, n.body, n.category, n.priority, n.status,
               n.publish_at as "publishAt", n.expires_at as "expiresAt",
               u.display_name as "createdBy", n.created_at as "createdAt"
          from notice n
          left join app_user u on u.id = n.created_by
         where n.id = ${id}
      `
      if (!notice) throw notFound('No such notice.')

      if (!canManage) {
        const keys = await audienceKeysFor(tx, principal)
        const [visible] = await tx<{ ok: boolean }[]>`
          select true as ok from notice n
           where n.id = ${id} and n.status = 'published' and n.publish_at <= now()
             and (n.expires_at is null or n.expires_at > now())
             and exists (
               select 1 from notice_audience na
                where na.notice_id = n.id
                  and (
                    na.audience_type = 'everyone'
                    or (na.audience_type = 'role' and na.role_id = any(${keys.roleIds}::uuid[]))
                    or (na.audience_type = 'class_level' and na.class_level_id = any(${keys.classIds}::uuid[]))
                    or (na.audience_type = 'section' and na.section_id = any(${keys.sectionIds}::uuid[]))
                    or (na.audience_type = 'student' and na.student_id = any(${keys.studentIds}::uuid[]))
                  )
             )
        `
        if (!visible) throw forbidden('That notice is not addressed to you.')

        // Reading it marks it read; that is the whole point of read receipts.
        await tx`
          insert into notice_read (notice_id, user_id, tenant_id)
          values (${id}, ${principal.user.userId}, app_current_tenant())
          on conflict do nothing
        `
      }

      const audiences = await tx<Record<string, unknown>[]>`
        select na.audience_type as "type", r.key as "roleKey", cl.name as "className",
               sec.name as "sectionName", st.first_name as "studentName"
          from notice_audience na
          left join role r on r.id = na.role_id
          left join class_level cl on cl.id = na.class_level_id
          left join section sec on sec.id = na.section_id
          left join student st on st.id = na.student_id
         where na.notice_id = ${id}
      `

      let readCount: number | null = null
      if (canManage) {
        const [row] = await tx<{ n: string }[]>`
          select count(*) as n from notice_read where notice_id = ${id}
        `
        readCount = Number(row!.n)
      }

      return { ...notice, audiences, readCount }
    })
  })

  app.post('/notices', async (request, reply) => {
    const principal = request.require('notice.write')
    const body = noticeInput.parse(request.body)

    if (body.expiresAt && body.publishAt && body.expiresAt <= body.publishAt) {
      throw badRequest('The notice must expire after it is published.')
    }

    return request.tx(async (tx) => {
      const [session] = await tx<{ id: string }[]>`
        select id from academic_session where is_current limit 1
      `
      if (!session) throw badRequest('No current academic session.')

      const [notice] = await tx<{ id: string }[]>`
        insert into notice (tenant_id, session_id, title, body, category, priority,
                            publish_at, expires_at, status, created_by)
        values (app_current_tenant(), ${session.id}, ${body.title}, ${body.body},
                ${body.category ?? 'general'}, ${body.priority},
                ${body.publishAt ?? new Date().toISOString()}, ${body.expiresAt ?? null},
                'draft', ${principal.user.userId})
        returning id
      `

      await insertAudiences(tx, notice!.id, body.audiences)

      reply.code(201)
      return { id: notice!.id, status: 'draft' }
    })
  })

  app.patch('/notices/:id', async (request) => {
    request.require('notice.write')
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const body = noticeInput.partial().parse(request.body)

    return request.tx(async (tx) => {
      const [notice] = await tx<{ status: string }[]>`select status from notice where id = ${id}`
      if (!notice) throw notFound('No such notice.')

      const patch: Record<string, unknown> = {}
      if (body.title !== undefined) patch.title = body.title
      if (body.body !== undefined) patch.body = body.body
      if (body.category !== undefined) patch.category = body.category
      if (body.priority !== undefined) patch.priority = body.priority
      if (body.publishAt !== undefined) patch.publish_at = body.publishAt
      if (body.expiresAt !== undefined) patch.expires_at = body.expiresAt

      if (Object.keys(patch).length) {
        await tx`update notice set ${tx(patch)} where id = ${id}`
      }
      if (body.audiences) {
        await tx`delete from notice_audience where notice_id = ${id}`
        await insertAudiences(tx, id, body.audiences)
      }

      return { id, updated: true }
    })
  })

  /**
   * Publishing is a distinct act from saving. A draft is invisible; once
   * published it is addressed to real families, so it needs its own click.
   */
  app.post('/notices/:id/publish', async (request) => {
    const principal = request.require('notice.write')
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    return request.tx(async (tx) => {
      const [notice] = await tx<{ status: string }[]>`select status from notice where id = ${id}`
      if (!notice) throw notFound('No such notice.')
      if (notice.status === 'published') return { id, status: 'published', alreadyPublished: true }
      if (notice.status === 'archived') throw badRequest('Archived notices cannot be republished.')

      const [audiences] = await tx<{ n: string }[]>`
        select count(*) as n from notice_audience where notice_id = ${id}
      `
      if (Number(audiences!.n) === 0) {
        throw badRequest('Choose who this notice is for before publishing.', 'no_audience')
      }

      await tx`
        update notice set status = 'published', published_by = ${principal.user.userId}
         where id = ${id}
      `
      return { id, status: 'published' }
    })
  })

  app.delete('/notices/:id', async (request) => {
    request.require('notice.write')
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    return request.tx(async (tx) => {
      const rows = await tx<{ id: string }[]>`
        update notice set status = 'archived' where id = ${id} returning id
      `
      if (!rows.length) throw notFound('No such notice.')
      return { id, status: 'archived' }
    })
  })

  app.post('/notices/:id/read', async (request) => {
    const principal = request.require('notice.read')
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    return request.tx(async (tx) => {
      await tx`
        insert into notice_read (notice_id, user_id, tenant_id)
        values (${id}, ${principal.user.userId}, app_current_tenant())
        on conflict do nothing
      `
      return { id, read: true }
    })
  })
}

async function insertAudiences(
  tx: Tx,
  noticeId: string,
  audiences: z.infer<typeof audienceSchema>,
) {
  for (const audience of audiences) {
    let roleId: string | null = null
    if (audience.type === 'role') {
      if (!audience.roleKey) throw badRequest('A role audience needs a role.')
      const [role] = await tx<{ id: string }[]>`select id from role where key = ${audience.roleKey}`
      if (!role) throw badRequest(`No such role: ${audience.roleKey}`)
      roleId = role.id
    }

    // The CHECK constraint in migration 0008 enforces the type/target pairing;
    // this just produces a readable error before we get there.
    const target = {
      everyone: true,
      role: Boolean(roleId),
      class_level: Boolean(audience.classLevelId),
      section: Boolean(audience.sectionId),
      student: Boolean(audience.studentId),
    }[audience.type]
    if (!target) throw badRequest(`A ${audience.type.replace('_', ' ')} audience is missing its target.`)

    await tx`
      insert into notice_audience (tenant_id, notice_id, audience_type, role_id,
                                   class_level_id, section_id, student_id)
      values (app_current_tenant(), ${noticeId}, ${audience.type}, ${roleId},
              ${audience.classLevelId ?? null}, ${audience.sectionId ?? null},
              ${audience.studentId ?? null})
    `
  }
}
