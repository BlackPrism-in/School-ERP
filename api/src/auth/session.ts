import { createHash, randomBytes } from 'node:crypto'
import type { Tx } from '../db/client.js'
import { env } from '../env.js'

/**
 * Lucia-style opaque sessions.
 *
 * The token the browser holds is 32 random bytes. What we store is its
 * SHA-256 — so a database leak (a stolen backup, an exposed replica) yields
 * no usable sessions. There is no JWT: revocation must be immediate, and a
 * school admin disabling a compromised account cannot wait for a token to
 * expire on its own.
 *
 * Validation is deliberately two-phase. Phase 1 reads `user_session` alone,
 * with no tenant context — the session row is what *tells* us the tenant.
 * Joining `app_user` here would hit its RLS policy while app.tenant_id is
 * still null and return nothing. Phase 2 loads the user inside that tenant's
 * context, where the normal policies apply.
 */

const HOUR_MS = 3_600_000

export type SessionUser = {
  userId: string
  tenantId: string
  displayName: string
  email: string | null
  status: string
  mustChangePassword: boolean
  mfaEnabled: boolean
}

export type SessionRef = {
  sessionId: string
  userId: string
  tenantId: string
  expiresAt: Date
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(
  tx: Tx,
  input: { userId: string; tenantId: string; ip?: string | null; userAgent?: string | null },
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken()
  const expiresAt = new Date(Date.now() + env().SESSION_TTL_HOURS * HOUR_MS)

  await tx`
    insert into user_session (id, user_id, tenant_id, expires_at, ip, user_agent)
    values (${hashToken(token)}, ${input.userId}, ${input.tenantId}, ${expiresAt},
            ${input.ip ?? null}, ${input.userAgent ?? null})
  `

  return { token, expiresAt }
}

/**
 * Phase 1 — resolve a token to its session row. Runs without tenant context,
 * relying on the `session_lookup` policy from migration 0010. Expired
 * sessions are deleted on sight rather than left for a cron job.
 */
export async function lookupSession(tx: Tx, token: string): Promise<SessionRef | null> {
  const id = hashToken(token)

  const rows = await tx<
    { id: string; user_id: string; tenant_id: string; expires_at: Date }[]
  >`select id, user_id, tenant_id, expires_at from user_session where id = ${id}`

  const row = rows[0]
  if (!row) return null

  if (row.expires_at.getTime() <= Date.now()) {
    await tx`delete from user_session where id = ${id}`
    return null
  }

  return {
    sessionId: row.id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    expiresAt: row.expires_at,
  }
}

/**
 * Phase 2 — load the user inside their tenant's context and refresh the
 * session's expiry if it is close enough to warrant a write.
 */
export async function loadSessionUser(tx: Tx, ref: SessionRef): Promise<SessionUser | null> {
  const rows = await tx<
    {
      id: string
      tenant_id: string
      display_name: string
      email: string | null
      status: string
      must_change_password: boolean
      mfa_enabled: boolean
    }[]
  >`
    select id, tenant_id, display_name, email, status, must_change_password, mfa_enabled
      from app_user
     where id = ${ref.userId} and deleted_at is null
  `

  const row = rows[0]
  if (!row) {
    await tx`delete from user_session where id = ${ref.sessionId}`
    return null
  }

  // A disabled or locked account loses every existing session immediately,
  // not at next expiry.
  if (row.status !== 'active') {
    await tx`delete from user_session where user_id = ${row.id}`
    return null
  }

  // Sliding expiry: extend only inside the renewal window, so we are not
  // writing to this row on every single request.
  const renewWithin = env().SESSION_RENEW_WITHIN_HOURS * HOUR_MS
  if (ref.expiresAt.getTime() - Date.now() < renewWithin) {
    const next = new Date(Date.now() + env().SESSION_TTL_HOURS * HOUR_MS)
    await tx`update user_session set expires_at = ${next}, last_seen_at = now() where id = ${ref.sessionId}`
  } else {
    await tx`update user_session set last_seen_at = now() where id = ${ref.sessionId}`
  }

  return {
    userId: row.id,
    tenantId: row.tenant_id,
    displayName: row.display_name,
    email: row.email,
    status: row.status,
    mustChangePassword: row.must_change_password,
    mfaEnabled: row.mfa_enabled,
  }
}

export async function invalidateSession(tx: Tx, sessionId: string): Promise<void> {
  await tx`delete from user_session where id = ${sessionId}`
}

/** Used on password change and on admin-forced sign-out. */
export async function invalidateAllUserSessions(tx: Tx, userId: string): Promise<void> {
  await tx`delete from user_session where user_id = ${userId}`
}
