import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { ZodError } from 'zod'
import postgres from 'postgres'
import { env } from './env.js'
import { contextPlugin } from './plugins/context.js'
import { authRoutes } from './auth/routes.js'
import { studentRoutes } from './modules/students/routes.js'
import { dashboardRoutes } from './modules/dashboard/routes.js'
import { AppError } from './lib/errors.js'
import { db } from './db/client.js'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env().LOG_LEVEL,
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    },
    trustProxy: true,
    disableRequestLogging: env().NODE_ENV === 'test',
  })

  await app.register(helmet, { contentSecurityPolicy: false })
  await app.register(cors, {
    origin: env().CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
  })
  await app.register(cookie)

  /**
   * Global ceiling. Login gets its own much tighter limit below — credential
   * stuffing is the attack that matters against a school portal.
   */
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    // Tests would otherwise trip the limiter and fail intermittently.
    global: env().NODE_ENV !== 'test',
  })

  await app.register(contextPlugin)

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'validation_failed',
          message: 'Some fields need attention.',
          fields: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      })
    }

    if (error instanceof AppError) {
      if (error.status >= 500) request.log.error({ err: error, internal: error.internal })
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } })
    }

    if (error instanceof postgres.PostgresError) {
      // Constraint violations from migrations 0004-0009 are real business
      // rules. Surface them as 409s rather than 500s, but never leak the
      // constraint name or SQL to the client.
      request.log.warn({ err: error, constraint: error.constraint_name }, 'database constraint rejected write')
      if (error.code === '23505') {
        return reply.code(409).send({ error: { code: 'conflict', message: 'That record already exists.' } })
      }
      if (error.code === '23503' || error.code === '23514' || error.code === '23P01') {
        return reply.code(400).send({ error: { code: 'invalid_data', message: 'That change is not allowed.' } })
      }
      if (error.code === '2F003' || error.code === '38002') {
        return reply.code(409).send({ error: { code: 'immutable_record', message: error.message } })
      }
    }

    if ((error as { statusCode?: number }).statusCode === 429) {
      return reply.code(429).send({
        error: { code: 'too_many_requests', message: 'Too many requests. Please slow down.' },
      })
    }

    request.log.error({ err: error }, 'unhandled error')
    return reply
      .code(500)
      .send({ error: { code: 'internal_error', message: 'Something went wrong on our side.' } })
  })

  app.get('/health', { config: { public: true } }, async () => {
    await db()`select 1`
    return { status: 'ok', at: new Date().toISOString() }
  })

  await app.register(
    async (scoped) => {
      await scoped.register(rateLimit, {
        max: env().LOGIN_RATE_LIMIT_MAX,
        timeWindow: `${env().LOGIN_RATE_WINDOW_MINUTES} minutes`,
        keyGenerator: (request) => `${request.ip}:login`,
        enableDraftSpec: true,
      })
      await scoped.register(authRoutes)
    },
    { prefix: '' },
  )

  await app.register(studentRoutes)
  await app.register(dashboardRoutes)

  return app
}
