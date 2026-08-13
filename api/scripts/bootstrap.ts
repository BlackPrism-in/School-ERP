/**
 * Creates the tenant and its first superadmin.
 *
 * Deliberately does NOT invent a password. It generates one, prints it once,
 * and sets must_change_password — so no deployment ever ships with a
 * credential that exists in a repo, a README or a chat log.
 *
 *   npm run bootstrap -- --name "St. Xavier's High School" --email principal@school.edu
 */
import { randomBytes } from 'node:crypto'
import { db, closeDb } from '../src/db/client.js'
import { hashPassword } from '../src/auth/password.js'
import { env } from '../src/env.js'

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i === -1 ? undefined : process.argv[i + 1]
}

function generatePassword(): string {
  // Ambiguous characters removed — this gets read off a screen and typed.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = randomBytes(20)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

const name = arg('--name') ?? 'EduNova Demo School'
const email = arg('--email')
const slug = arg('--slug') ?? env().TENANT_SLUG

if (!email) {
  console.error('Missing --email. Usage: npm run bootstrap -- --name "School" --email admin@school.edu')
  process.exit(1)
}

const sql = db()
const password = generatePassword()

try {
  const result = await sql.begin(async (tx) => {
    const existing = await tx<{ id: string }[]>`select id from tenant where slug = ${slug}`
    if (existing.length) {
      throw new Error(`A tenant with slug "${slug}" already exists. Nothing was changed.`)
    }

    const [tenant] = await tx<{ id: string }[]>`
      insert into tenant (slug, name) values (${slug}, ${name}) returning id
    `
    await tx`select seed_system_roles(${tenant!.id})`

    await tx`select set_config('app.tenant_id', ${tenant!.id}, true)`

    const [user] = await tx<{ id: string }[]>`
      insert into app_user (tenant_id, email, password_hash, display_name, must_change_password)
      values (${tenant!.id}, ${email}, ${await hashPassword(password)}, 'School Administrator', true)
      returning id
    `
    await tx`
      insert into user_role (user_id, role_id)
      select ${user!.id}, id from role where tenant_id = ${tenant!.id} and key = 'superadmin'
    `

    // A school cannot do anything without a current academic session.
    const year = new Date().getFullYear()
    await tx`
      insert into academic_session (tenant_id, name, start_date, end_date, is_current, status)
      values (${tenant!.id}, ${`${year}-${String((year + 1) % 100).padStart(2, '0')}`},
              ${`${year}-04-01`}, ${`${year + 1}-03-31`}, true, 'active')
    `
    await tx`
      insert into branch (tenant_id, code, name, is_primary)
      values (${tenant!.id}, 'MAIN', 'Main Campus', true)
    `

    return { tenantId: tenant!.id, userId: user!.id }
  })

  console.log(`
  Tenant created.

    School     ${name}
    Slug       ${slug}
    Tenant ID  ${result.tenantId}

  Sign in with:

    Email      ${email}
    Password   ${password}

  This password is shown once and must be changed at first sign-in.
  Enrol MFA immediately — superadmin can read every student record.
`)
} catch (error) {
  console.error(`\n  Bootstrap failed: ${(error as Error).message}\n`)
  process.exitCode = 1
} finally {
  await closeDb()
}
