import type { Logger } from './logger.ts'

export type ServerStartInfo = {
  port?: number
  db: string
  production: boolean
  authBaseUrl: string
  trustedOrigins: readonly string[]
}

/**
 * Lifecycle events live here, spelled once, so the composition roots (`index.ts`,
 * `db/migrate.ts`) stay thin and the event names/fields have unit tests.
 */
export function logServerStart(logger: Logger, info: ServerStartInfo): void {
  logger.info('server.start', {
    port: info.port,
    db: info.db,
    env: info.production ? 'production' : 'development',
    authBaseUrl: info.authBaseUrl,
    trustedOrigins: [...info.trustedOrigins],
  })
}

export function logServerStop(logger: Logger, signal: string): void {
  logger.info('server.stop', { signal })
}

export function logDbConnectFailed(logger: Logger, target: string, error: unknown): void {
  logger.error('db.connect_failed', {
    target,
    error,
    hints: ['docker compose up -d db', 'check DATABASE_URL in .env'],
  })
}

export function logMigrate(logger: Logger, folder: string, ms: number): void {
  logger.info('db.migrate', { folder, ms })
}

export function logUnhandled(
  logger: Logger,
  kind: 'uncaughtException' | 'unhandledRejection',
  error: unknown,
): void {
  logger.error('process.unhandled_error', { kind, error })
}
