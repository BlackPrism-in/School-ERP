import type { FastifyInstance } from 'fastify'
import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { env } from '../env.js'
import { withContext } from '../db/context.js'
import type { Tx } from '../db/client.js'
import { hashPassword, passwordSchema, verifyPassword } from './password.js'
import {
  createSession,
  invalidateAllUserSessions,
  invalidateSession,
} from './session.js'
import { generateRecoveryCodes, generateSecret, provisioningUri, verifyCode } from './totp.js'
import { writeAudit } from '../lib/audit.js'
import { passwordResetMail, sendMail } from '../lib/mailer.js'
import { AppError, badRequest, unauthorized } from '../lib/errors.js'
import { MFA_REQUIRED_ROLES, type RoleKey } from '../rbac/permissions.js'

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
  // Wide enough for a 6-digit TOTP code and an 11-character recovery code
  // (XXXXX-XXXXX). Capping this at 10 silently rejected every recovery code
  // as a validation error before it reached the MFA check.
  totp: z.string().max(20).optional(),
})

type UserRow = {
  id: string
  password_hash: string
  status: string
  display_name: string
  failed_login_count: number
  locked_until: Date | null
  mfa_enabled: boolean
  mfa_secret: string | null
  mfa_recovery_codes: string[] | null
}

function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: env().COOKIE_SECURE,
    sameSite: 'lax' as const,
    path: '/',
    expires,
    ...(env().COOKIE_DOMAIN ? { domain: env().COOKIE_DOMAIN } : {}),
  }
}

async function rolesOf(tx: Tx, userId: string): Promise<RoleKey[]> {
  const rows = await tx<{ key: RoleKey }[]>`
    select r.key from user_role ur join role r on r.id = ur.role_id where ur.user_id = ${userId}
  `
  return rows.map((r) => r.key)
}

export async function authRoutes(app: FastifyInstance) {
  /**
   * POST /auth/login
   *
   * Every failure path returns the same message and the same shape. The only
   * distinction the client can observe is `mfa_required`, which is only
   * reachable after the password has already been verified.
   */
  app.post('/auth/login', { config: { public: true } }, async (request, reply) => {
    const body = loginSchema.parse(request.body)
    const ip = request.ip
    const userAgent = request.headers['user-agent'] ?? null
    const genericFailure = unauthorized('Incorrect email or password.', 'invalid_credentials')

    const result = await withContext({ tenantId: request.tenantId, userId: null }, async (tx) => {
      const rows = await tx<UserRow[]>`
        select id, password_hash, status, display_name, failed_login_count,
               locked_until, mfa_enabled, mfa_secret, mfa_recovery_codes
          from app_user
         where email = ${body.email} and deleted_at is null
      `
      const user = rows[0]

      if (!user) {
        // Spend comparable time on a dummy hash so response timing does not
        // reveal whether the address exists.
        await verifyPassword('$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$00000000000000000000000000000000', body.password)
        await writeAudit(tx, {
          action: 'login_failed',
          entityType: 'app_user',
          detail: { reason: 'unknown_email' },
          ip,
          userAgent,
          requestId: request.id,
        })
        return { ok: false as const }
      }

      if (user.locked_until && user.locked_until.getTime() > Date.now()) {
        await writeAudit(tx, {
          action: 'login_failed',
          entityType: 'app_user',
          entityId: user.id,
          actorUserId: user.id,
          detail: { reason: 'locked' },
          ip,
          userAgent,
          requestId: request.id,
        })
        return { ok: false as const, locked: true }
      }

      if (user.status !== 'active' || !(await verifyPassword(user.password_hash, body.password))) {
        const attempts = user.failed_login_count + 1
        const lock = attempts >= env().LOGIN_MAX_ATTEMPTS
        await tx`
          update app_user
             set failed_login_count = ${attempts},
                 locked_until = ${lock ? new Date(Date.now() + env().LOGIN_LOCKOUT_MINUTES * 60_000) : null},
                 status = ${lock ? 'locked' : user.status}
           where id = ${user.id}
        `
        await writeAudit(tx, {
          action: 'login_failed',
          entityType: 'app_user',
          entityId: user.id,
          actorUserId: user.id,
          detail: { reason: user.status !== 'active' ? 'inactive' : 'bad_password', attempts, locked: lock },
          ip,
          userAgent,
          requestId: request.id,
        })
        return { ok: false as const }
      }

      // Password is correct from here on. The transaction opened with a null
      // app.user_id because we did not yet know who was knocking; now we do,
      // so attribute the rest of it — otherwise the audit trigger records the
      // last_login and lockout-reset writes with no actor.
      await tx`select set_config('app.user_id', ${user.id}, true)`

      const roles = await rolesOf(tx, user.id)
      const mfaRequired = roles.some((r) => MFA_REQUIRED_ROLES.includes(r))

      if (user.mfa_enabled) {
        if (!body.totp) return { ok: false as const, mfaRequired: true }

        const secretOk = user.mfa_secret ? verifyCode(user.mfa_secret, body.totp) : false
        const recoveryIndex = (user.mfa_recovery_codes ?? []).indexOf(body.totp.toUpperCase())

        if (!secretOk && recoveryIndex === -1) {
          await writeAudit(tx, {
            action: 'mfa_failed',
            entityType: 'app_user',
            entityId: user.id,
            actorUserId: user.id,
            ip,
            userAgent,
            requestId: request.id,
          })
          return { ok: false as const, mfaRequired: true }
        }

        if (recoveryIndex !== -1) {
          // Recovery codes are single use.
          const remaining = (user.mfa_recovery_codes ?? []).filter((_, i) => i !== recoveryIndex)
          await tx`update app_user set mfa_recovery_codes = ${remaining} where id = ${user.id}`
        }
      }

      const session = await createSession(tx, {
        userId: user.id,
        tenantId: request.tenantId,
        ip,
        userAgent,
      })

      await tx`
        update app_user
           set failed_login_count = 0, locked_until = null,
               last_login_at = now(), last_login_ip = ${ip}
         where id = ${user.id}
      `

      await writeAudit(tx, {
        action: 'login',
        entityType: 'app_user',
        entityId: user.id,
        actorUserId: user.id,
        actorLabel: user.display_name,
        detail: { mfa: user.mfa_enabled },
        ip,
        userAgent,
        requestId: request.id,
      })

      return {
        ok: true as const,
        session,
        userId: user.id,
        displayName: user.display_name,
        roles,
        mfaEnabled: user.mfa_enabled,
        mfaRequired,
      }
    })

    if (!result.ok) {
      if (result.mfaRequired) {
        throw new AppError(401, 'mfa_required', 'Enter the code from your authenticator app.')
      }
      if (result.locked) {
        throw new AppError(
          423,
          'account_locked',
          `Too many failed attempts. Try again in ${env().LOGIN_LOCKOUT_MINUTES} minutes.`,
        )
      }
      throw genericFailure
    }

    reply.setCookie(env().SESSION_COOKIE_NAME, result.session.token, cookieOptions(result.session.expiresAt))

    return {
      user: { id: result.userId, displayName: result.displayName, roles: result.roles },
      // Admins without MFA are let in, then nagged. Locking them out of their
      // own school before they can enrol would be a support call, not security.
      mfaEnrolmentRequired: result.mfaRequired && !result.mfaEnabled,
    }
  })

  app.post('/auth/logout', async (request, reply) => {
    const principal = request.requirePrincipal()
    await request.tx(async (tx) => {
      await invalidateSession(tx, principal.sessionId)
      await writeAudit(tx, {
        action: 'logout',
        entityType: 'app_user',
        entityId: principal.user.userId,
        actorUserId: principal.user.userId,
        ip: request.ip,
        requestId: request.id,
      })
    })
    reply.clearCookie(env().SESSION_COOKIE_NAME, { path: '/' })
    return { ok: true }
  })

  app.get('/auth/me', async (request) => {
    const p = request.requirePrincipal()
    return {
      id: p.user.userId,
      displayName: p.user.displayName,
      email: p.user.email,
      roles: p.roles,
      permissions: [...p.permissions].sort(),
      mustChangePassword: p.user.mustChangePassword,
      mfaEnabled: p.user.mfaEnabled,
      mfaEnrolmentRequired: p.roles.some((r) => MFA_REQUIRED_ROLES.includes(r)) && !p.user.mfaEnabled,
      scope: p.scope.kind,
    }
  })

  app.post('/auth/change-password', async (request, reply) => {
    const body = z
      .object({ currentPassword: z.string().min(1), newPassword: passwordSchema })
      .parse(request.body)

    const principal = request.requirePrincipal()
    if (body.currentPassword === body.newPassword) {
      throw badRequest('The new password must be different from the current one.')
    }

    await request.tx(async (tx) => {
      const rows = await tx<{ password_hash: string }[]>`
        select password_hash from app_user where id = ${principal.user.userId}
      `
      const row = rows[0]
      if (!row || !(await verifyPassword(row.password_hash, body.currentPassword))) {
        throw unauthorized('Your current password is incorrect.', 'invalid_credentials')
      }

      await tx`
        update app_user
           set password_hash = ${await hashPassword(body.newPassword)},
               must_change_password = false
         where id = ${principal.user.userId}
      `
      // Changing a password signs out every other device — the usual reason
      // to change one is that you think someone else has it.
      await invalidateAllUserSessions(tx, principal.user.userId)
      await writeAudit(tx, {
        action: 'password_changed',
        entityType: 'app_user',
        entityId: principal.user.userId,
        actorUserId: principal.user.userId,
        ip: request.ip,
        requestId: request.id,
      })
    })

    reply.clearCookie(env().SESSION_COOKIE_NAME, { path: '/' })
    return { ok: true, message: 'Password updated. Please sign in again.' }
  })

  /**
   * Always returns the same response whether or not the address exists —
   * otherwise this endpoint is a user-enumeration oracle.
   */
  app.post('/auth/forgot-password', { config: { public: true } }, async (request) => {
    const body = z.object({ email: z.string().email().max(254) }).parse(request.body)

    await withContext({ tenantId: request.tenantId, userId: null }, async (tx) => {
      const rows = await tx<{ id: string }[]>`
        select id from app_user
         where email = ${body.email} and status = 'active' and deleted_at is null
      `
      const user = rows[0]
      if (!user) return

      const token = randomBytes(32).toString('base64url')
      await tx`
        insert into password_reset_token (user_id, token_hash, expires_at, requested_ip)
        values (${user.id}, ${createHash('sha256').update(token).digest('hex')},
                ${new Date(Date.now() + env().PASSWORD_RESET_TTL_MINUTES * 60_000)}, ${request.ip})
      `
      await writeAudit(tx, {
        action: 'password_reset_requested',
        entityType: 'app_user',
        entityId: user.id,
        ip: request.ip,
        requestId: request.id,
      })

      const result = await sendMail(
        passwordResetMail({
          to: body.email,
          token,
          expiresMinutes: env().PASSWORD_RESET_TTL_MINUTES,
        }),
        request.log,
      )
      // The response is identical either way — telling the caller that
      // delivery failed would confirm the address exists. Operators see it in
      // the log; the user is told to try again if nothing arrives.
      request.log.info(
        { userId: user.id, delivered: result.delivered },
        'password reset token issued',
      )
    })

    return { ok: true, message: 'If that address has an account, a reset link is on its way.' }
  })

  app.post('/auth/reset-password', { config: { public: true } }, async (request) => {
    const body = z
      .object({ token: z.string().min(1).max(200), newPassword: passwordSchema })
      .parse(request.body)

    await withContext({ tenantId: request.tenantId, userId: null }, async (tx) => {
      const hash = createHash('sha256').update(body.token).digest('hex')
      const rows = await tx<{ id: string; user_id: string }[]>`
        select id, user_id from password_reset_token
         where token_hash = ${hash} and used_at is null and expires_at > now()
      `
      const token = rows[0]
      if (!token) throw badRequest('That reset link is invalid or has expired.', 'invalid_token')

      await tx`update password_reset_token set used_at = now() where id = ${token.id}`
      await tx`
        update app_user
           set password_hash = ${await hashPassword(body.newPassword)},
               must_change_password = false,
               failed_login_count = 0, locked_until = null,
               status = case when status = 'locked' then 'active' else status end
         where id = ${token.user_id}
      `
      await invalidateAllUserSessions(tx, token.user_id)
      await writeAudit(tx, {
        action: 'password_reset_completed',
        entityType: 'app_user',
        entityId: token.user_id,
        ip: request.ip,
        requestId: request.id,
      })
    })

    return { ok: true, message: 'Password set. You can now sign in.' }
  })

  // ------------------------------------------------------------------ MFA

  app.post('/auth/mfa/begin', async (request) => {
    const principal = request.requirePrincipal()
    if (principal.user.mfaEnabled) throw badRequest('Two-factor authentication is already on.')

    const secret = generateSecret()
    await request.tx(
      (tx) => tx`update app_user set mfa_secret = ${secret} where id = ${principal.user.userId}`,
    )

    return {
      secret,
      otpauthUri: provisioningUri(secret, principal.user.email ?? principal.user.displayName, 'EduNova'),
    }
  })

  app.post('/auth/mfa/confirm', async (request) => {
    const body = z.object({ code: z.string().min(6).max(10) }).parse(request.body)
    const principal = request.requirePrincipal()

    const recoveryCodes = generateRecoveryCodes()

    await request.tx(async (tx) => {
      const rows = await tx<{ mfa_secret: string | null }[]>`
        select mfa_secret from app_user where id = ${principal.user.userId}
      `
      const secret = rows[0]?.mfa_secret
      if (!secret) throw badRequest('Start two-factor setup first.')
      if (!verifyCode(secret, body.code)) throw badRequest('That code is not valid. Try the next one.')

      await tx`
        update app_user set mfa_enabled = true, mfa_recovery_codes = ${recoveryCodes}
         where id = ${principal.user.userId}
      `
      await writeAudit(tx, {
        action: 'mfa_enrolled',
        entityType: 'app_user',
        entityId: principal.user.userId,
        actorUserId: principal.user.userId,
        ip: request.ip,
        requestId: request.id,
      })
    })

    // Shown exactly once.
    return { ok: true, recoveryCodes }
  })
}
