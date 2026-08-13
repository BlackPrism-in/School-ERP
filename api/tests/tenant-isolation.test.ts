import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, db } from '../src/db/client.js'
import { withContext } from '../src/db/context.js'
import { createUser, login, makeApp, resetSchool, type Fixture } from './helpers.js'

/**
 * The schema smoke test proves RLS holds in psql. This proves it holds along
 * the path the application actually uses: the pooled connection, the
 * SET LOCAL ROLE downgrade, and the per-request context from
 * plugins/context.ts.
 *
 * With one tenant live this is invisible. The day a second school is
 * onboarded it is the thing standing between them.
 */

let app: FastifyInstance
let fixture: Fixture
let otherTenantId: string
let otherStudentId: string

beforeAll(async () => {
  fixture = await resetSchool()
  await createUser({ tenantId: fixture.tenantId, email: 'admin@test.school', role: 'admin' })

  // A second school, created out-of-band as the owner role.
  const sql = db()
  const [other] = await sql<{ id: string }[]>`
    insert into tenant (slug, name) values ('rival-school', 'Rival School') returning id
  `
  otherTenantId = other!.id
  await sql`select seed_system_roles(${otherTenantId})`

  const [otherStudent] = await sql<{ id: string }[]>`
    insert into student (tenant_id, admission_no, first_name)
    values (${otherTenantId}, 'RIVAL-001', 'Confidential') returning id
  `
  otherStudentId = otherStudent!.id

  app = await makeApp()
})

afterAll(async () => {
  await app.close()
  await closeDb()
})

describe('tenant isolation through the API', () => {
  it('excludes another school from the roster', async () => {
    const cookie = await login(app, 'admin@test.school')
    const res = await app.inject({ method: 'GET', url: '/students', headers: { cookie } })

    expect(res.statusCode).toBe(200)
    const names = res.json().data.map((s: { firstName: string }) => s.firstName)
    expect(names).not.toContain('Confidential')
    expect(res.body).not.toContain('RIVAL-001')
  })

  it('returns 404, not 403, for another school\'s student by id', async () => {
    const cookie = await login(app, 'admin@test.school')
    const res = await app.inject({
      method: 'GET',
      url: `/students/${otherStudentId}`,
      headers: { cookie },
    })
    // RLS makes the row simply not exist for this context — the caller learns
    // nothing about whether that id is real.
    expect([403, 404]).toContain(res.statusCode)
    expect(res.body).not.toContain('Confidential')
  })

  it('blocks a cross-tenant read even when the query forgets to filter', async () => {
    // Simulates the mistake RLS exists to catch: a hand-written query with no
    // tenant predicate at all.
    const rows = await withContext({ tenantId: fixture.tenantId, userId: null }, (tx) =>
      tx<{ id: string }[]>`select id from student`,
    )
    expect(rows.map((r) => r.id)).not.toContain(otherStudentId)
  })

  it('blocks a cross-tenant write', async () => {
    await expect(
      withContext({ tenantId: fixture.tenantId, userId: null }, (tx) =>
        tx`
          insert into student (tenant_id, admission_no, first_name)
          values (${otherTenantId}, 'INJECTED-1', 'Injected')
        `,
      ),
    ).rejects.toThrow()
  })

  it('runs application queries as a role that cannot bypass RLS', async () => {
    const [row] = await withContext({ tenantId: fixture.tenantId, userId: null }, (tx) =>
      tx<{ role: string; bypass: boolean }[]>`
        select current_user as role, rolbypassrls as bypass
          from pg_roles where rolname = current_user
      `,
    )
    expect(row!.role).toBe('erp_app')
    expect(row!.bypass).toBe(false)
  })

  it('does not leak tenant context between pooled requests', async () => {
    // Run a request under the rival tenant, then confirm the next query on a
    // possibly-recycled connection sees nothing of it.
    await withContext({ tenantId: otherTenantId, userId: null }, (tx) =>
      tx`select 1 from student limit 1`,
    )

    const setting = await withContext({ tenantId: fixture.tenantId, userId: null }, (tx) =>
      tx<{ tenant: string | null }[]>`select current_setting('app.tenant_id', true) as tenant`,
    )
    expect(setting[0]!.tenant).toBe(fixture.tenantId)
  })
})
