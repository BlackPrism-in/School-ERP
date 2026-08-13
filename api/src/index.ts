import { buildApp } from './app.js'
import { env } from './env.js'
import { closeDb } from './db/client.js'

const app = await buildApp()

async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down')
  try {
    await app.close()
    await closeDb()
    process.exit(0)
  } catch (error) {
    app.log.error({ err: error }, 'shutdown failed')
    process.exit(1)
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

try {
  await app.listen({ port: env().PORT, host: env().HOST })
} catch (error) {
  app.log.error({ err: error }, 'failed to start')
  process.exit(1)
}
