import { defineConfig } from 'vitest/config'

const TEST_DB = process.env.TEST_DB_NAME ?? 'edunova_api_test'

export default defineConfig({
  test: {
    // Source only. Without this, a prior `npm run build` leaves compiled
    // copies of the suite in dist/ and every test runs twice.
    include: ['tests/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    globalSetup: ['./tests/global-setup.ts'],
    // Files run one at a time, each in its own isolated process. Fixtures
    // truncate and rebuild the school, and the resolved tenant id is cached
    // per module — parallel or shared-process runs would collide on both.
    pool: 'forks',
    isolate: true,
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? `postgres://localhost:5432/${TEST_DB}`,
      DB_APP_ROLE: 'erp_app',
      TENANT_SLUG: 'test-school',
      COOKIE_SECURE: 'false',
      LOG_LEVEL: 'error',
      SESSION_TTL_HOURS: '12',
      LOGIN_MAX_ATTEMPTS: '5',
      LOGIN_LOCKOUT_MINUTES: '15',
      // The per-IP login throttle would otherwise trip partway through the
      // suite. It is covered explicitly in tests/rate-limit.test.ts, which
      // builds an app with a deliberately tiny limit.
      LOGIN_RATE_LIMIT_MAX: '10000',
    },
  },
})
