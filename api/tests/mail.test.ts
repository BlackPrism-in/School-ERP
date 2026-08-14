import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, db } from '../src/db/client.js'
import { capturedMail, clearCapturedMail } from '../src/lib/mailer.js'
import { loadEnv } from '../src/env.js'
import { createUser, login, makeApp, resetSchool, type Fixture } from './helpers.js'

let app: FastifyInstance
let fixture: Fixture
let adminCookie: string

beforeAll(async () => {
  fixture = await resetSchool()
  await createUser({ tenantId: fixture.tenantId, email: 'admin@test.school', role: 'admin' })
  // A separate account for the reset tests: completing a reset invalidates
  // every session for that user, which would otherwise kill adminCookie.
  await createUser({ tenantId: fixture.tenantId, email: 'resetme@test.school', role: 'teacher' })
  app = await makeApp()
  adminCookie = await login(app, 'admin@test.school')
})

afterAll(async () => {
  await app.close()
  await closeDb()
})

beforeEach(() => clearCapturedMail())

describe('password reset email', () => {
  it('sends a link carrying a token that actually works', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'resetme@test.school' },
    })
    expect(res.statusCode).toBe(200)
    expect(capturedMail()).toHaveLength(1)

    const mail = capturedMail()[0]!
    expect(mail.to).toBe('resetme@test.school')
    expect(mail.subject).toMatch(/reset/i)

    // Pull the token out of the link exactly as a user clicking it would.
    const token = new URL(mail.text.match(/https?:\/\/\S+/)![0]).searchParams.get('token')
    expect(token).toBeTruthy()

    const reset = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token, newPassword: 'MailedResetWorks42' },
    })
    expect(reset.statusCode).toBe(200)

    // And the new password gets them in.
    await expect(login(app, 'resetme@test.school', 'MailedResetWorks42')).resolves.toBeTruthy()
  })

  /** Sending on an unknown address would confirm the address does not exist. */
  it('sends nothing for an unknown address but answers identically', async () => {
    const known = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'resetme@test.school' },
    })
    clearCapturedMail()

    const unknown = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'ghost@test.school' },
    })

    expect(unknown.statusCode).toBe(known.statusCode)
    expect(unknown.json()).toEqual(known.json())
    expect(capturedMail()).toHaveLength(0)
  })

  it('states the expiry in the message', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'resetme@test.school' },
    })
    expect(capturedMail()[0]!.text).toContain('30 minutes')
  })
})

describe('account created email', () => {
  it('welcomes the staff member without ever emailing the password', async () => {
    const staff = await app.inject({
      method: 'POST',
      url: '/staff',
      headers: { cookie: adminCookie },
      payload: { employeeNo: 'MAIL-1', firstName: 'Maya', lastName: 'Thomas' },
    })
    clearCapturedMail()

    const account = await app.inject({
      method: 'POST',
      url: `/staff/${staff.json().id}/account`,
      headers: { cookie: adminCookie },
      payload: { email: 'maya@test.school', role: 'teacher' },
    })
    expect(account.statusCode).toBe(201)

    const { temporaryPassword } = account.json()
    expect(capturedMail()).toHaveLength(1)

    const mail = capturedMail()[0]!
    expect(mail.to).toBe('maya@test.school')
    expect(mail.text).toContain('Maya Thomas')
    expect(mail.text).toContain('Test School')

    // The credential is handed over in person, never left sitting in a mailbox.
    expect(mail.text).not.toContain(temporaryPassword)
    expect(mail.html).not.toContain(temporaryPassword)
  })

  /**
   * A mail outage must not roll back the account. The admin has the password
   * on screen and can pass it on regardless.
   */
  it('still creates the account when delivery fails', async () => {
    const staff = await app.inject({
      method: 'POST',
      url: '/staff',
      headers: { cookie: adminCookie },
      payload: { employeeNo: 'MAIL-2', firstName: 'Broken', lastName: 'Mail' },
    })

    process.env.MAIL_DRIVER = 'smtp'
    process.env.SMTP_HOST = '127.0.0.1'
    process.env.SMTP_PORT = '1' // nothing listening
    const { resetEnvCache } = await import('../src/env.js')
    resetEnvCache()

    try {
      const account = await app.inject({
        method: 'POST',
        url: `/staff/${staff.json().id}/account`,
        headers: { cookie: adminCookie },
        payload: { email: 'broken@test.school', role: 'teacher' },
      })
      expect(account.statusCode).toBe(201)
      expect(account.json().temporaryPassword).toBeTruthy()

      const [user] = await db()<{ id: string }[]>`
        select id from app_user where email = 'broken@test.school'
      `
      expect(user).toBeDefined()
    } finally {
      process.env.MAIL_DRIVER = 'capture'
      delete process.env.SMTP_HOST
      delete process.env.SMTP_PORT
      const { resetEnvCache: reset } = await import('../src/env.js')
      reset()
    }
  })
})

describe('production configuration guards', () => {
  const base = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://localhost/x',
    TENANT_SLUG: 'x',
    COOKIE_SECURE: 'true',
  }

  /**
   * A production box that logs reset links instead of sending them looks fine
   * until a locked-out administrator needs one.
   */
  it('refuses to boot in production with a non-sending mail driver', () => {
    expect(() => loadEnv({ ...base, MAIL_DRIVER: 'console' } as NodeJS.ProcessEnv)).toThrow(/smtp/i)
  })

  it('refuses smtp with no host', () => {
    expect(() => loadEnv({ ...base, MAIL_DRIVER: 'smtp' } as NodeJS.ProcessEnv)).toThrow(/SMTP_HOST/)
  })

  it('refuses an insecure cookie in production', () => {
    expect(() =>
      loadEnv({ ...base, COOKIE_SECURE: 'false', MAIL_DRIVER: 'smtp', SMTP_HOST: 'x' } as NodeJS.ProcessEnv),
    ).toThrow(/COOKIE_SECURE/)
  })

  it('accepts a correct production configuration', () => {
    expect(() =>
      loadEnv({ ...base, MAIL_DRIVER: 'smtp', SMTP_HOST: 'smtp.example.com' } as NodeJS.ProcessEnv),
    ).not.toThrow()
  })
})
