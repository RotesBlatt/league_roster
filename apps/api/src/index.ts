import { createApp } from './app.ts'
import { trustedOrigins } from './auth.ts'
import { client } from './db/index.ts'
import { env } from './env.ts'
import { createDestinations } from './lib/log/destinations.ts'
import {
  logDbConnectFailed,
  logServerStart,
  logServerStop,
  logUnhandled,
} from './lib/log/lifecycle.ts'
import { createLogger } from './lib/log/logger.ts'

export type { App } from './app.ts'

const destinations = await createDestinations(env.log)
const logger = createLogger({ level: env.log.level, destination: destinations })

// Fail fast and actionably, instead of erroring on the first request.
try {
  await client`select 1`
} catch (error) {
  logDbConnectFailed(logger, env.databaseTarget, error)
  await destinations.close()
  process.exit(1)
}

const app = createApp({ logger }).listen(env.port)
logServerStart(logger, {
  port: app.server?.port,
  db: env.databaseTarget,
  production: env.isProduction,
  authBaseUrl: env.betterAuthUrl,
  trustedOrigins,
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    logServerStop(logger, signal)
    await app.stop()
    await destinations.close()
    process.exit(0)
  })
}

process.on('uncaughtException', (error) => {
  logUnhandled(logger, 'uncaughtException', error)
  void destinations.close().finally(() => process.exit(1))
})

process.on('unhandledRejection', (reason) => {
  logUnhandled(logger, 'unhandledRejection', reason)
  void destinations.close().finally(() => process.exit(1))
})
