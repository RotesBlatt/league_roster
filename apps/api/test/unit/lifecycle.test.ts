import { describe, expect, test } from 'bun:test'
import {
  logDbConnectFailed,
  logMigrate,
  logServerStart,
  logServerStop,
  logUnhandled,
} from '../../src/lib/log/lifecycle.ts'
import { createLogger } from '../../src/lib/log/logger.ts'

function capture() {
  const lines: string[] = []
  const logger = createLogger({
    level: 'debug',
    destination: { write: (chunk) => lines.push(chunk) },
  })
  return {
    logger,
    records() {
      return lines
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    },
  }
}

describe('lifecycle events', () => {
  test('server.start lists port, db target, mode, auth url and trusted origins', () => {
    const s = capture()
    logServerStart(s.logger, {
      port: 3001,
      db: 'localhost:5432/lol',
      production: false,
      authBaseUrl: 'http://localhost:5173',
      trustedOrigins: ['http://localhost:5173', 'http://localhost:3001'],
    })

    expect(s.records()[0]).toMatchObject({
      event: 'server.start',
      level: 'info',
      port: 3001,
      db: 'localhost:5432/lol',
      env: 'development',
      authBaseUrl: 'http://localhost:5173',
      trustedOrigins: ['http://localhost:5173', 'http://localhost:3001'],
    })
  })

  test('server.stop records the signal', () => {
    const s = capture()
    logServerStop(s.logger, 'SIGTERM')
    expect(s.records()[0]).toMatchObject({ event: 'server.stop', level: 'info', signal: 'SIGTERM' })
  })

  test('db.connect_failed is an error with the target and the cause', () => {
    const s = capture()
    logDbConnectFailed(s.logger, 'localhost:5432/lol', new Error('refused'))

    const record = s.records()[0]
    expect(record).toMatchObject({
      event: 'db.connect_failed',
      level: 'error',
      target: 'localhost:5432/lol',
    })
    expect(record.error.message).toBe('refused')
  })

  test('db.migrate records folder and duration', () => {
    const s = capture()
    logMigrate(s.logger, 'apps/api/drizzle', 42)
    expect(s.records()[0]).toMatchObject({
      event: 'db.migrate',
      level: 'info',
      folder: 'apps/api/drizzle',
      ms: 42,
    })
  })

  test('process.unhandled_error records the kind and the error', () => {
    const s = capture()
    logUnhandled(s.logger, 'unhandledRejection', new Error('boom'))

    const record = s.records()[0]
    expect(record).toMatchObject({
      event: 'process.unhandled_error',
      level: 'error',
      kind: 'unhandledRejection',
    })
    expect(record.error.message).toBe('boom')
  })
})
