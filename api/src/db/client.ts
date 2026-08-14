import postgres from 'postgres'
import { env } from '../env.js'

export type Sql = postgres.Sql<Record<string, never>>
/** A transaction-scoped handle. Same query API as `Sql`. */
export type Tx = postgres.TransactionSql<Record<string, never>>

let pool: Sql | null = null

export function db(): Sql {
  pool ??= postgres(env().DATABASE_URL, {
    max: env().DB_POOL_MAX,
    // Money must round-trip exactly. postgres.js hands back numeric as string
    // by default, which is what we want — parsing to JS number would silently
    // lose precision on large amounts. Keep it explicit so nobody "helpfully"
    // adds a numeric parser later.
    types: {},
    onnotice: env().NODE_ENV === 'development' ? undefined : () => {},
    transform: { undefined: null },
  })
  return pool
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end({ timeout: 5 })
    pool = null
  }
}
