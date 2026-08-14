import { defineConfig, devices } from '@playwright/test'

const API_PORT = process.env.E2E_API_PORT ?? '3210'
const WEB_PORT = process.env.E2E_WEB_PORT ?? '4173'
const DB = process.env.E2E_DB ?? 'edunova_e2e'
// CI needs credentials; locally the unix socket is enough.
const DB_URL = process.env.E2E_DATABASE_URL ?? `postgres://localhost:5432/${DB}`

/**
 * End-to-end runs against a real API and a real database, both started here
 * and torn down after. `global-setup.ts` recreates the database from
 * `supabase/migrations` and seeds a school, so a broken migration fails E2E
 * too rather than passing on a stale schema.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      command: `npx tsx src/index.ts`,
      cwd: './api',
      port: Number(API_PORT),
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'development',
        PORT: API_PORT,
        DATABASE_URL: DB_URL,
        DB_APP_ROLE: 'erp_app',
        TENANT_SLUG: 'e2e-school',
        COOKIE_SECURE: 'false',
        LOG_LEVEL: 'warn',
        MAIL_DRIVER: 'console',
        APP_URL: `http://localhost:${WEB_PORT}`,
        CORS_ORIGIN: `http://localhost:${WEB_PORT}`,
        LOGIN_RATE_LIMIT_MAX: '1000',
      },
    },
    {
      // Preview the production build, not the dev server: this is the bundle
      // that would actually ship.
      command: `npx vite build && npx vite preview --port ${WEB_PORT} --strictPort`,
      port: Number(WEB_PORT),
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_API_URL: `http://localhost:${API_PORT}` },
    },
  ],
})
