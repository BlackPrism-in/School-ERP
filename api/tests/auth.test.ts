import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, db } from '../src/db/client.js'
import { generateCode } from '../src/auth/totp.js'
import {
  PASSWORD,
  createUser,
  login,
  makeApp,
  resetSchool,
  type Fixture,
} from './helpers.js'

let app: FastifyInstance
let fixture: Fixture

beforeAll(async () => {
  fixture = await resetSchool()
  await createUser({ tenantId: fixture.tenantId, email: 'admin@test.school', role: 'admin' })
  await createUser({
    tenantId: fixture.tenantId,
    email: 'newjoiner@test.school',
    role: 'teacher',
    mustChangePassword: true,
  })
  app = await makeApp()
})

afterAll(async () => {
  await app.close()
  await closeDb()
})

describe('login', () => {
  it('signs in with correct credentials and sets an httpOnly cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@test.school', password: PASSWORD },
    })

    expect(res.statusCode).toBe(200)
    const cookie = res.cookies.find((c) => c.name === 'edunova_session')
    expect(cookie).toBeDefined()
    expect(cookie!.httpOnly).toBe(true)
    expect(cookie!.sameSite).toBe('Lax')
    expect(res.json().user.roles).toEqual(['admin'])
  })

  it('stores only a hash of the session token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@test.school', password: PASSWORD },
    })
    const raw = res.cookies.find((c) => c.name === 'edunova_session')!.value

    const rows = await db()<{ id: string }[]>`select id from user_session`
    expect(rows.length).toBeGreaterThan(0)
    // The raw token must appear nowhere in the table.
    expect(rows.some((r) => r.id === raw)).toBe(false)
  })

  it('gives the same answer for a wrong password and an unknown address', async () => {
    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@test.school', password: 'NotThePassword123' },
    })
    const unknownUser = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nobody@test.school', password: 'NotThePassword123' },
    })

    expect(wrongPassword.statusCode).toBe(401)
    expect(unknownUser.statusCode).toBe(401)
    // No user-enumeration oracle.
    expect(wrongPassword.json()).toEqual(unknownUser.json())
  })

  it('locks the account after the configured number of failures', async () => {
    await createUser({ tenantId: fixture.tenantId, email: 'locktest@test.school', role: 'teacher' })

    for (let i = 0; i < 5; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'locktest@test.school', password: 'WrongPassword123' },
      })
      expect(res.statusCode).toBe(401)
    }

    // Correct password now, but the account is locked.
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'locktest@test.school', password: PASSWORD },
    })
    expect(res.statusCode).toBe(423)
    expect(res.json().error.code).toBe('account_locked')

    const [row] = await db()<{ status: string; locked_until: Date | null }[]>`
      select status, locked_until from app_user where email = 'locktest@test.school'
    `
    expect(row!.status).toBe('locked')
    expect(row!.locked_until).not.toBeNull()
  })

  it('records both successes and failures in the audit log', async () => {
    const rows = await db()<{ action: string }[]>`
      select action from audit_log where entity_type = 'app_user' and action in ('login', 'login_failed')
    `
    expect(rows.filter((r) => r.action === 'login').length).toBeGreaterThan(0)
    expect(rows.filter((r) => r.action === 'login_failed').length).toBeGreaterThan(0)
  })
})

describe('session enforcement', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await app.inject({ method: 'GET', url: '/students' })
    expect(res.statusCode).toBe(401)
  })

  it('rejects a forged cookie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/students',
      headers: { cookie: 'edunova_session=totally-made-up-token' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects a session whose user has been disabled mid-session', async () => {
    const userId = await createUser({
      tenantId: fixture.tenantId,
      email: 'disableme@test.school',
      role: 'admin',
    })
    const cookie = await login(app, 'disableme@test.school')

    const before = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })
    expect(before.statusCode).toBe(200)

    await db()`update app_user set status = 'disabled' where id = ${userId}`

    const after = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })
    expect(after.statusCode).toBe(401)

    // Every session for that user is gone, not just this one.
    const sessions = await db()<{ id: string }[]>`select id from user_session where user_id = ${userId}`
    expect(sessions).toHaveLength(0)
  })

  it('signs out and invalidates the session', async () => {
    const cookie = await login(app, 'admin@test.school')
    const out = await app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie } })
    expect(out.statusCode).toBe(200)

    const after = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })
    expect(after.statusCode).toBe(401)
  })
})

describe('forced password change', () => {
  it('blocks other endpoints until the password is changed', async () => {
    const cookie = await login(app, 'newjoiner@test.school')

    const blocked = await app.inject({ method: 'GET', url: '/students', headers: { cookie } })
    expect(blocked.statusCode).toBe(403)
    expect(blocked.json().error.code).toBe('password_change_required')

    // /auth/me stays reachable so the UI can explain why.
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })
    expect(me.statusCode).toBe(200)
    expect(me.json().mustChangePassword).toBe(true)
  })

  it('clears the flag once changed, and signs every device out', async () => {
    const cookie = await login(app, 'newjoiner@test.school')

    const res = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: { cookie },
      payload: { currentPassword: PASSWORD, newPassword: 'BrandNewPassphrase42' },
    })
    expect(res.statusCode).toBe(200)

    // Old session is dead.
    const stale = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })
    expect(stale.statusCode).toBe(401)

    // New password works and the flag is gone.
    const fresh = await login(app, 'newjoiner@test.school', 'BrandNewPassphrase42')
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: fresh } })
    expect(me.json().mustChangePassword).toBe(false)
  })

  it('rejects a weak new password', async () => {
    const cookie = await login(app, 'admin@test.school')
    const res = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: { cookie },
      payload: { currentPassword: PASSWORD, newPassword: 'short' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('validation_failed')
  })
})

describe('password reset', () => {
  it('answers identically for known and unknown addresses', async () => {
    const known = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'admin@test.school' },
    })
    const unknown = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'ghost@test.school' },
    })
    expect(known.statusCode).toBe(200)
    expect(known.json()).toEqual(unknown.json())
  })

  it('resets with a valid token, unlocks the account, and burns the token', async () => {
    // locktest was locked out earlier; a reset should recover it.
    await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'locktest@test.school' },
    })

    // The email provider is not wired yet, so read the token the way the
    // reset link would carry it. We stored only its hash, so mint a known one.
    const { createHash, randomBytes } = await import('node:crypto')
    const token = randomBytes(32).toString('base64url')
    const [user] = await db()<{ id: string }[]>`
      select id from app_user where email = 'locktest@test.school'
    `
    await db()`
      insert into password_reset_token (user_id, token_hash, expires_at)
      values (${user!.id}, ${createHash('sha256').update(token).digest('hex')},
              now() + interval '30 minutes')
    `

    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token, newPassword: 'RecoveredAccess77' },
    })
    expect(res.statusCode).toBe(200)

    // Account is usable again.
    const cookie = await login(app, 'locktest@test.school', 'RecoveredAccess77')
    expect(cookie).toBeTruthy()

    // The token cannot be replayed.
    const replay = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token, newPassword: 'AnotherPassword88' },
    })
    expect(replay.statusCode).toBe(400)
    expect(replay.json().error.code).toBe('invalid_token')
  })

  it('rejects an expired token', async () => {
    const { createHash, randomBytes } = await import('node:crypto')
    const token = randomBytes(32).toString('base64url')
    const [user] = await db()<{ id: string }[]>`
      select id from app_user where email = 'admin@test.school'
    `
    await db()`
      insert into password_reset_token (user_id, token_hash, expires_at)
      values (${user!.id}, ${createHash('sha256').update(token).digest('hex')},
              now() - interval '1 minute')
    `

    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token, newPassword: 'ShouldNotWork123' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('MFA', () => {
  it('enrols, then demands a code at next sign-in', async () => {
    await createUser({ tenantId: fixture.tenantId, email: 'mfa@test.school', role: 'admin' })
    const cookie = await login(app, 'mfa@test.school')

    const begin = await app.inject({ method: 'POST', url: '/auth/mfa/begin', headers: { cookie } })
    expect(begin.statusCode).toBe(200)
    const { secret, otpauthUri } = begin.json()
    expect(otpauthUri).toContain('otpauth://totp/')

    const bad = await app.inject({
      method: 'POST',
      url: '/auth/mfa/confirm',
      headers: { cookie },
      payload: { code: '000000' },
    })
    expect(bad.statusCode).toBe(400)

    const confirm = await app.inject({
      method: 'POST',
      url: '/auth/mfa/confirm',
      headers: { cookie },
      payload: { code: generateCode(secret) },
    })
    expect(confirm.statusCode).toBe(200)
    const recoveryCodes: string[] = confirm.json().recoveryCodes
    expect(recoveryCodes).toHaveLength(10)

    // Password alone is no longer enough.
    const noCode = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'mfa@test.school', password: PASSWORD },
    })
    expect(noCode.statusCode).toBe(401)
    expect(noCode.json().error.code).toBe('mfa_required')

    // Correct code gets in.
    const withCode = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'mfa@test.school', password: PASSWORD, totp: generateCode(secret) },
    })
    expect(withCode.statusCode).toBe(200)

    // A recovery code works once, then is burned.
    const firstUse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'mfa@test.school', password: PASSWORD, totp: recoveryCodes[0] },
    })
    expect(firstUse.statusCode).toBe(200)

    const replay = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'mfa@test.school', password: PASSWORD, totp: recoveryCodes[0] },
    })
    expect(replay.statusCode).toBe(401)
  })

  it('tells an admin without MFA to enrol', async () => {
    const cookie = await login(app, 'admin@test.school')
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })
    expect(me.json().mfaEnrolmentRequired).toBe(true)
  })
})
