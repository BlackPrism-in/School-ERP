import { execFileSync } from 'node:child_process'
import { readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const DB = process.env.E2E_DB ?? 'edunova_e2e'
const ROOT = resolve(import.meta.dirname, '..')
const MIGRATIONS = join(ROOT, 'supabase/migrations')

function psql(sql: string) {
  // -q suppresses the "INSERT 0 1" command tag, which would otherwise be
  // appended to the returned id.
  return execFileSync('psql', ['-q', '-tA', '-d', DB, '-c', sql], { encoding: 'utf8' }).trim()
}

/**
 * Builds the E2E database from the same migrations production will run, then
 * seeds a school with known accounts. Passwords are fixed here **only**
 * because this database is destroyed on every run — nothing in the shipped
 * application ever has a known credential.
 */
export default async function globalSetup() {
  execFileSync('dropdb', ['--if-exists', DB], { stdio: 'ignore' })
  execFileSync('createdb', [DB], { stdio: 'ignore' })

  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    execFileSync('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-d', DB, '-f', join(MIGRATIONS, file)], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' },
    })
  }

  // Argon2id hash of E2eTestPassword99 — precomputed so setup stays synchronous.
  const { hashPassword } = await import('../api/src/auth/password.js')
  const hash = await hashPassword('E2eTestPassword99')

  const tenantId = psql(
    `insert into tenant (slug, name) values ('e2e-school', 'Playwright High School') returning id`,
  )
  psql(`select seed_system_roles('${tenantId}')`)
  psql(`select set_config('app.tenant_id', '${tenantId}', false)`)

  const sessionId = psql(
    `insert into academic_session (tenant_id, name, start_date, end_date, is_current, status)
     values ('${tenantId}', '2026-27', '2026-04-01', '2027-03-31', true, 'active') returning id`,
  )
  const branchId = psql(
    `insert into branch (tenant_id, code, name, is_primary)
     values ('${tenantId}', 'MAIN', 'Main Campus', true) returning id`,
  )
  const classId = psql(
    `insert into class_level (tenant_id, name, sort_order)
     values ('${tenantId}', 'Grade 10', 10) returning id`,
  )
  const sectionId = psql(
    `insert into section (tenant_id, branch_id, class_level_id, session_id, name)
     values ('${tenantId}', '${branchId}', '${classId}', '${sessionId}', 'A') returning id`,
  )
  psql(`insert into subject (tenant_id, name) values ('${tenantId}', 'Mathematics')`)

  function makeUser(email: string, name: string, role: string) {
    const id = psql(
      `insert into app_user (tenant_id, email, password_hash, display_name, must_change_password)
       values ('${tenantId}', '${email}', '${hash}', '${name}', false) returning id`,
    )
    psql(
      `insert into user_role (user_id, role_id)
       select '${id}', id from role where tenant_id = '${tenantId}' and key = '${role}'`,
    )
    return id
  }

  makeUser('admin@e2e.school', 'Olivia Martin', 'admin')
  const teacherUser = makeUser('teacher@e2e.school', 'Maya Thomas', 'teacher')

  const staffId = psql(
    `insert into staff (tenant_id, user_id, employee_no, first_name, last_name, is_teaching)
     values ('${tenantId}', '${teacherUser}', 'EMP-001', 'Maya', 'Thomas', true) returning id`,
  )
  psql(
    `insert into teaching_assignment (tenant_id, session_id, staff_id, section_id, subject_id)
     select '${tenantId}', '${sessionId}', '${staffId}', '${sectionId}', id
       from subject where tenant_id = '${tenantId}' limit 1`,
  )

  for (const [admissionNo, first, last, roll] of [
    ['ADM-001', 'Aarav', 'Mehta', '1'],
    ['ADM-002', 'Diya', 'Kapoor', '2'],
    ['ADM-003', 'Ishaan', 'Verma', '3'],
  ]) {
    const studentId = psql(
      `insert into student (tenant_id, admission_no, first_name, last_name, status)
       values ('${tenantId}', '${admissionNo}', '${first}', '${last}', 'active') returning id`,
    )
    psql(
      `insert into enrolment (tenant_id, student_id, session_id, branch_id, class_level_id, section_id, roll_no)
       values ('${tenantId}', '${studentId}', '${sessionId}', '${branchId}', '${classId}', '${sectionId}', '${roll}')`,
    )
  }

  // Ids the specs need, rather than re-querying in each one.
  writeFileSync(
    join(ROOT, 'e2e/.fixture.json'),
    JSON.stringify({ tenantId, sessionId, branchId, classId, sectionId }, null, 2),
  )
}
