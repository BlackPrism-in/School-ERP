import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb } from '../src/db/client.js'
import { resetEnvCache } from '../src/env.js'
import { createUser, resetSchool } from './helpers.js'

/**
 * The rest of the suite runs with the login throttle effectively disabled, so
 * it is verified here in isolation with a deliberately tiny limit. Credential
 * stuffing is the attack that actually matters against a school portal.
 */
describe('login rate limiting', () => {
  let app: Awaited<ReturnType<typeof import('../src/app.js').buildApp>>

  beforeAll(async () => {
    const fixture = await resetSchool()
    await createUser({ tenantId: fixture.tenantId, email: 'throttle@test.school', role: 'teacher' })

    // env() memoises on first read — and resetSchool() has already triggered
    // it via the db client — so the cache must be cleared before buildApp
    // reads the lowered limit.
    process.env.LOGIN_RATE_LIMIT_MAX = '3'
    resetEnvCache()

    const { buildApp } = await import('../src/app.js')
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    delete process.env.LOGIN_RATE_LIMIT_MAX
    resetEnvCache()
    await app.close()
    await closeDb()
  })

  it('throttles repeated attempts from one IP', async () => {
    const attempt = () =>
      app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'throttle@test.school', password: 'WrongPassword123' },
        remoteAddress: '203.0.113.10',
      })

    const statuses: number[] = []
    for (let i = 0; i < 5; i += 1) statuses.push((await attempt()).statusCode)

    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0)
    expect(statuses[0]).toBe(401)
  })
})
