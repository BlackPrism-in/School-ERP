import { db, type Sql, type Tx } from './client.js'
import { env } from '../env.js'

/**
 * The request context every authenticated query runs under.
 *
 * `tenantId` drives the RLS policies from migration 0010; `userId` is picked
 * up by the audit triggers in 0009 so every write records who made it.
 */
export type DbContext = {
  tenantId: string
  userId: string | null
}

/**
 * Runs `fn` inside a single transaction with the request context applied.
 *
 * This is the single most load-bearing function in the API. Three things
 * happen before any application query runs:
 *
 *   1. `SET LOCAL ROLE erp_app` — downgrades from the connection's owner role
 *      to one that cannot bypass RLS. Without this, every policy in 0010 is
 *      decorative, because table owners are exempt unless FORCE is set (and
 *      we should not rely on remembering FORCE on every future table).
 *   2. `set_config('app.tenant_id', …, true)` — the `true` makes it
 *      transaction-local, so a pooled connection cannot leak one request's
 *      tenant into the next.
 *   3. `set_config('app.user_id', …, true)` — feeds the audit triggers.
 *
 * All three are reverted on COMMIT or ROLLBACK by virtue of being LOCAL.
 */
export async function withContext<T>(
  ctx: DbContext,
  fn: (tx: Tx) => Promise<T>,
  sql: Sql = db(),
): Promise<T> {
  return sql.begin(async (tx) => {
    const role = env().DB_APP_ROLE
    if (role) {
      // Role names cannot be parameterised, so it is validated as an
      // identifier at config load and injected via postgres.js's identifier
      // escaping rather than string concatenation.
      await tx`set local role ${tx(role)}`
    }
    await tx`select set_config('app.tenant_id', ${ctx.tenantId}, true)`
    await tx`select set_config('app.user_id', ${ctx.userId}, true)`
    return fn(tx)
  }) as Promise<T>
}

/**
 * For the narrow set of queries that must run BEFORE a tenant is known:
 * resolving the tenant itself, and looking up a session by its token hash.
 * Still downgrades to erp_app, so the RLS policies decide what is visible —
 * see the `tenant_self` and `session_lookup` policies.
 */
export async function withoutContext<T>(
  fn: (tx: Tx) => Promise<T>,
  sql: Sql = db(),
): Promise<T> {
  return sql.begin(async (tx) => {
    const role = env().DB_APP_ROLE
    if (role) await tx`set local role ${tx(role)}`
    return fn(tx)
  }) as Promise<T>
}
