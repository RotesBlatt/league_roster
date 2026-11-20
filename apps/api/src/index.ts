import { createApp } from './app.ts'
import { trustedOrigins } from './auth.ts'
import { client } from './db/index.ts'
import { env } from './env.ts'
import { createDestinations } from './lib/log/destinations.ts'
import { createLogger } from './lib/log/logger.ts'

export type { App } from './app.ts'

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? ` (${error.code})` : ''
    return `${error.message || error.name}${code}`
  }
  return String(error)
}

// Fail fast and actionably, instead of erroring on the first request.
try {
  await client`select 1`
  console.info(`[db] connected to ${env.databaseTarget}`)
} catch (error) {
  console.error(
    `[db] cannot reach Postgres at ${env.databaseTarget}.\n` +
      '  local dev:  docker compose up -d db\n' +
      '  otherwise:  check DATABASE_URL in .env\n' +
      `  cause: ${describeError(error)}`,
  )
  process.exit(1)
}

const destinations = await createDestinations(env.log)
const logger = createLogger({ level: env.log.level, destination: destinations })

const app = createApp({ logger }).listen(env.port)

console.info(`[api] listening on http://localhost:${app.server?.port} (db: ${env.databaseTarget})`)
console.info(`[auth] baseURL ${env.betterAuthUrl} · trusted origins: ${trustedOrigins.join(', ')}`)
