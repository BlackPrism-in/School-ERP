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

  /**
   * How long after marking attendance a record can be amended as a normal
   * edit. Beyond this it becomes a *correction*: it needs the
   * attendance.correct permission, a written reason, and it is recorded in
   * attendance_correction as well as the audit log.
   */
  ATTENDANCE_EDIT_WINDOW_HOURS: z.coerce.number().int().positive().default(48),

  /** Public URL of the frontend; used to build links in emails. */
  APP_URL: z.string().url().default('http://localhost:5173'),

  /**
   * smtp = real delivery · console = log it (development) ·
   * capture = keep in memory (tests). Production refuses anything but smtp.
   */
  MAIL_DRIVER: z.enum(['smtp', 'console', 'capture']).default('console'),
  MAIL_FROM: z.string().default('EduNova <no-reply@example.school>'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),

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

  // A production deployment that silently logs password-reset links instead of
  // sending them would look like it works right up until a locked-out
  // administrator needs it.
  if (parsed.data.NODE_ENV === 'production') {
    if (parsed.data.MAIL_DRIVER !== 'smtp') {
      throw new Error('MAIL_DRIVER must be "smtp" in production.')
    }
    if (!parsed.data.SMTP_HOST) {
      throw new Error('SMTP_HOST is required when MAIL_DRIVER is "smtp".')
    }
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
