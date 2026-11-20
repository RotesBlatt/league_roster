import { describe, expect, test } from 'bun:test'
import { createLogger } from '../../src/lib/log/logger.ts'
import { noopLogger } from '../../src/lib/log/noop.ts'

/** A destination that keeps every line, so a test can assert what a sink would see. */
function capture() {
  const lines: string[] = []
  return {
    destination: {
      write(chunk: string) {
        lines.push(chunk)
      },
    },
    records() {
      return lines
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    },
  }
}

describe('createLogger', () => {
  test('writes one NDJSON record per event with ts, level, event and fields', () => {
    const cap = capture()
    const log = createLogger({
      level: 'debug',
      destination: cap.destination,
      clock: () => new Date('2026-02-06T14:03:22.418Z'),
    })

    log.info('invite.claimed', { inviteId: 'inv_1', uses: 1 })

    expect(cap.records()).toHaveLength(1)
    expect(cap.records()[0]).toMatchObject({
      ts: '2026-02-06T14:03:22.418Z',
      level: 'info',
      event: 'invite.claimed',
      inviteId: 'inv_1',
      uses: 1,
    })
  })

  test('filters below the configured level', () => {
    const cap = capture()
    const log = createLogger({ level: 'warn', destination: cap.destination })

    log.debug('a')
    log.info('b')
    log.warn('c')
    log.error('d')

    expect(cap.records().map((record) => record.event)).toEqual(['c', 'd'])
  })

  test('child binds fields for later calls', () => {
    const cap = capture()
    const log = createLogger({ level: 'debug', destination: cap.destination })

    log.child({ component: 'members' }).info('member.updated', { targetUserId: 'u2' })

    expect(cap.records()[0]).toMatchObject({
      component: 'members',
      event: 'member.updated',
      targetUserId: 'u2',
    })
  })

  test('redacts credentials', () => {
    const cap = capture()
    const log = createLogger({ level: 'debug', destination: cap.destination })

    log.info('http.request', {
      cookie: 'session=abc',
      authorization: 'Bearer xyz',
      userId: 'u1',
    })

    const record = cap.records()[0]
    expect(record.cookie).toBe('[redacted]')
    expect(record.authorization).toBe('[redacted]')
    expect(record.userId).toBe('u1')
  })

  test('serializes an Error in the error field with its stack', () => {
    const cap = capture()
    const log = createLogger({ level: 'debug', destination: cap.destination })

    log.error('process.unhandled_error', { error: new Error('boom') })

    const record = cap.records()[0]
    expect(record.error.message).toBe('boom')
    expect(String(record.error.stack)).toContain('boom')
  })

  test('a destination that throws does not break the caller', () => {
    const log = createLogger({
      level: 'debug',
      destination: {
        write() {
          throw new Error('disk full')
        },
      },
    })

    expect(() => log.info('x')).not.toThrow()
  })
})

describe('noopLogger', () => {
  test('swallows everything and child returns itself', () => {
    expect(() => noopLogger.info('x', { a: 1 })).not.toThrow()
    expect(noopLogger.child({ a: 1 })).toBe(noopLogger)
  })
})
