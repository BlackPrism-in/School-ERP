import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { withContext, withoutContext } from '../db/context.js'
import type { Tx } from '../db/client.js'
import { lookupSession, loadSessionUser, type SessionUser } from '../auth/session.js'
import { resolveAccessScope, type AccessScope } from '../rbac/scope.js'
import type { Permission, RoleKey } from '../rbac/permissions.js'
import { env } from '../env.js'
import { forbidden, unauthorized, AppError } from '../lib/errors.js'

export type Principal = {
  user: SessionUser
  sessionId: string
  roles: RoleKey[]
  permissions: Set<Permission>
  scope: AccessScope
}

declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string
    principal: Principal | null
    /** Runs `fn` in a transaction carrying this request's tenant/user context. */
    tx: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>
    requirePrincipal: () => Principal
    require: (permission: Permission) => Principal
  }
}

/** Resolved once at boot; single-tenant today, subdomain-derived later. */
let cachedTenantId: string | null = null

async function resolveTenantId(): Promise<string> {
  if (cachedTenantId) return cachedTenantId
  const slug = env().TENANT_SLUG
  const rows = await withoutContext(
    (tx) => tx<{ id: string }[]>`select id from tenant where slug = ${slug} and status = 'active'`,
  )
  const row = rows[0]
  if (!row) throw new Error(`No active tenant with slug "${slug}". Run: npm run bootstrap`)
  cachedTenantId = row.id
  return cachedTenantId
}

export const contextPlugin = fp(async (app: FastifyInstance) => {
  // Fastify wants every request property declared up front so it can shape
  // the request object once. Function decorators get a throwing placeholder
  // rather than null: if one is ever called before the onRequest hook has
  // replaced it, that is a wiring bug and should say so loudly.
  const notReady = (): never => {
    throw new Error('Request context is not initialised yet.')
  }

  app.decorateRequest('tenantId', '')
  app.decorateRequest('principal', null)
  app.decorateRequest('tx', notReady)
  app.decorateRequest('requirePrincipal', notReady)
  app.decorateRequest('require', notReady)

  app.addHook('onRequest', async (request: FastifyRequest) => {
    request.tenantId = await resolveTenantId()

    request.tx = <T>(fn: (tx: Tx) => Promise<T>) =>
      withContext({ tenantId: request.tenantId, userId: request.principal?.user.userId ?? null }, fn)

    request.requirePrincipal = () => {
      if (!request.principal) throw unauthorized()
      return request.principal
    }

    request.require = (permission: Permission) => {
      const principal = request.requirePrincipal()
      if (!principal.permissions.has(permission)) {
        throw forbidden(`This action requires the "${permission}" permission.`)
      }
      return principal
    }
  })

  /**
   * Authenticate before every handler. Routes opt out with
   * `config: { public: true }` — an allowlist, so a new route is protected by
   * default rather than accidentally open.
   */
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if ((request.routeOptions.config as { public?: boolean } | undefined)?.public) return

    const token = request.cookies[env().SESSION_COOKIE_NAME]
    if (!token) throw unauthorized()

    const expired = () => {
      reply.clearCookie(env().SESSION_COOKIE_NAME, { path: '/' })
      return unauthorized('Your session has expired. Please sign in again.')
    }

    // Phase 1: no tenant context yet — the session row is what tells us which
    // tenant this request belongs to.
    const ref = await withoutContext((tx) => lookupSession(tx, token))
    if (!ref) throw expired()

    // A session minted for another school must never be honoured here.
    if (ref.tenantId !== request.tenantId) {
      reply.clearCookie(env().SESSION_COOKIE_NAME, { path: '/' })
      throw unauthorized()
    }

    // Phase 2: everything else runs under that tenant's policies.
    const resolved = await withContext(
      { tenantId: ref.tenantId, userId: ref.userId },
      async (tx) => {
        const user = await loadSessionUser(tx, ref)
        if (!user) return null

        const roleRows = await tx<{ key: RoleKey }[]>`
          select r.key from user_role ur join role r on r.id = ur.role_id
           where ur.user_id = ${user.userId}
        `
        const permRows = await tx<{ permission_key: Permission }[]>`
          select distinct rp.permission_key
            from user_role ur
            join role_permission rp on rp.role_id = ur.role_id
           where ur.user_id = ${user.userId}
        `
        const roleKeys = roleRows.map((r) => r.key)
        return {
          user,
          roles: roleKeys,
          permissions: new Set(permRows.map((r) => r.permission_key)),
          scope: await resolveAccessScope(tx, { userId: user.userId, roles: roleKeys }),
        }
      },
    )

    if (!resolved) throw expired()

    request.principal = {
      user: resolved.user,
      sessionId: ref.sessionId,
      roles: resolved.roles,
      permissions: resolved.permissions,
      scope: resolved.scope,
    }

    /**
     * A user under a forced password change is authenticated but may do
     * nothing except change it or sign out. This is what makes the
     * `must_change_password` default of true actually mean something.
     */
    const allowedWhileLocked = ['/auth/change-password', '/auth/logout', '/auth/me']
    if (resolved.user.mustChangePassword && !allowedWhileLocked.includes(request.url.split('?')[0]!)) {
      throw new AppError(
        403,
        'password_change_required',
        'You must set a new password before continuing.',
      )
    }
  })
})
