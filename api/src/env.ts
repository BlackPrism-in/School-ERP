import { z } from 'zod'

const bool = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1')

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().min(1),
  /**
   * Role the API downgrades to for every request transaction. It must not be
   * the table owner and must not have BYPASSRLS — that is what makes the
   * tenant-isolation policies in migration 0010 meaningful. Set to an empty
   * string only when connecting as erp_app directly.
   */
  DB_APP_ROLE: z.string().default('erp_app'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),

  /**
   * Single-tenant deployment: every request resolves to this school. When we
   * go multi-tenant this is replaced by subdomain resolution.
   */
  TENANT_SLUG: z.string().min(1),

  SESSION_COOKIE_NAME: z.string().default('edunova_session'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  /** Sessions within this window of expiry get extended on use. */
  SESSION_RENEW_WITHIN_HOURS: z.coerce.number().int().positive().default(4),
  COOKIE_SECURE: bool.default(true),
  COOKIE_DOMAIN: z.string().optional(),

  /** Failed logins before the account locks. */
  /** Per-IP login attempts allowed in LOGIN_RATE_WINDOW_MINUTES, before the throttle. */
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  LOGIN_RATE_WINDOW_MINUTES: z.coerce.number().int().positive().default(5),

  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(30),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
})

export type Env = z.infer<typeof schema>

let cached: Env | null = null

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }

  if (parsed.data.NODE_ENV === 'production' && !parsed.data.COOKIE_SECURE) {
    throw new Error('COOKIE_SECURE must be true in production.')
  }

  return parsed.data
}

export function env(): Env {
  cached ??= loadEnv()
  return cached
}

/**
 * Test-only. Config is memoised on first read, so a test that needs different
 * settings must clear the cache before rebuilding the app.
 */
export function resetEnvCache(): void {
  cached = null
}
