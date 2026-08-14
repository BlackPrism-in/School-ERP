import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const DB = process.env.TEST_DB_NAME ?? 'edunova_api_test'
const MIGRATIONS = resolve(import.meta.dirname, '../../supabase/migrations')

function run(cmd: string, args: string[]) {
  execFileSync(cmd, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' },
  })
}

/**
 * Builds the test database from the same migrations that will run against
 * Supabase. Nothing here is a test-only schema — if a migration is broken,
 * the whole suite fails at setup, which is the correct place to find out.
 */
export async function setup() {
  try {
    run('dropdb', ['--if-exists', DB])
    run('createdb', [DB])
  } catch (error) {
    throw new Error(
      `Could not create the test database "${DB}". Is PostgreSQL running?\n` +
        `Try: brew services start postgresql@14`,
      { cause: error },
    )
  }

  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    try {
      run('psql', ['-q', '-v', 'ON_ERROR_STOP=1', '-d', DB, '-f', join(MIGRATIONS, file)])
    } catch (error) {
      const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? ''
      throw new Error(`Migration ${file} failed:\n${stderr}`, { cause: error })
    }
  }
}

export async function teardown() {
  // Left in place deliberately — after a failure it is the first thing you
  // want to inspect. The next run recreates it.
}
