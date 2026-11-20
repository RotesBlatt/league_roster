import { describe, expect, test } from 'bun:test'
import { createRequestLog } from '../../src/lib/log/http.ts'
import { createLogger } from '../../src/lib/log/logger.ts'

function setup(options: { slowMs?: number; logAssets?: boolean } = {}) {
  const lines: string[] = []
  let now = 1000
  const logger = createLogger({
    level: 'debug',
    destination: {
      write(chunk) {
        lines.push(chunk)
      },
    },
  })
  const log = createRequestLog({
    logger,
    clock: () => now,
    slowMs: options.slowMs,
    logAssets: options.logAssets,
    generateId: () => 'fixed-id',
  })
  return {
    log,
    advance(ms: number) {
      now += ms
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

function ctx(url = 'http://localhost/api/players', headers: Record<string, string> = {}) {
  const request = new Request(url, { headers })
  const set: { status?: number | string; headers: Record<string, string> } = {
    status: 200,
    headers: {},
  }
  return { request, set }
}

describe('createRequestLog', () => {
  test('onRequest assigns an id and echoes it on the response headers', () => {
    const { log } = setup()
    const c = ctx()
    log.onRequest(c)
    expect(c.set.headers['x-request-id']).toBe('fixed-id')
  })

  test('accepts a well-formed inbound x-request-id and ignores a malformed one', () => {
    const { log } = setup()
    const good = ctx(undefined, { 'x-request-id': 'abc-123_XYZ' })
    log.onRequest(good)
    expect(good.set.headers['x-request-id']).toBe('abc-123_XYZ')

    const bad = ctx(undefined, { 'x-request-id': 'has spaces and \\n' })
    log.onRequest(bad)
    expect(bad.set.headers['x-request-id']).toBe('fixed-id')
  })

  test('onAfterResponse emits one http.request with method, path, status and duration', () => {
    const s = setup()
    const c = ctx('http://localhost/api/players?ignored=1')
    s.log.onRequest(c)
    s.advance(12)
    s.log.onAfterResponse({ ...c, response: { ok: true } })

    const records = s.records()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      event: 'http.request',
      id: 'fixed-id',
      method: 'GET',
      path: '/api/players',
      status: 200,
      ms: 12,
      level: 'info',
    })
  })

  test('status comes from a Response, then set.status; warns on 4xx and errors on 5xx', () => {
    const s = setup()
    const created = ctx()
    s.log.onRequest(created)
    s.log.onAfterResponse({
      ...created,
      response: new Response('', { status: 201 }),
    })
    expect(s.records()[0].status).toBe(201)

    const denied = ctx()
    denied.set.status = 403
    s.log.onRequest(denied)
    s.log.onAfterResponse({ ...denied, response: { message: 'Captain only' } })
    const record = s.records()[1]
    expect(record.status).toBe(403)
    expect(record.level).toBe('warn')
    expect(record.message).toBe('Captain only')

    const boom = ctx()
    boom.set.status = 500
    s.log.onRequest(boom)
    s.log.onAfterResponse({ ...boom, response: { message: 'Internal error' } })
    expect(s.records()[2].level).toBe('error')
  })

  test('served assets are debug unless logAssets is on', () => {
    const quiet = setup()
    const asset = ctx('http://localhost/assets/app.js')
    quiet.log.onRequest(asset)
    quiet.log.onAfterResponse({ ...asset, response: {} })
    expect(quiet.records()[0].level).toBe('debug')

    const loud = setup({ logAssets: true })
    const asset2 = ctx('http://localhost/assets/app.js')
    loud.log.onRequest(asset2)
    loud.log.onAfterResponse({ ...asset2, response: {} })
    expect(loud.records()[0].level).toBe('info')
  })

  test('onAfterHandle stamps user, role and membership status', () => {
    const s = setup()
    const c = ctx()
    s.log.onRequest(c)
    s.log.onAfterHandle({ ...c, user: { id: 'u1' }, me: { role: 'captain', status: 'active' } })
    s.log.onAfterResponse({ ...c, response: {} })
    expect(s.records()[0]).toMatchObject({
      userId: 'u1',
      role: 'captain',
      membership: 'active',
    })
  })

  test('captures the client ip and user agent', () => {
    const s = setup()
    const c = ctx(undefined, {
      'x-forwarded-for': '203.0.113.7, 10.0.0.1',
      'user-agent': 'Mozilla/5.0 test',
    })
    s.log.onRequest(c)
    s.log.onAfterResponse({ ...c, response: {} })
    expect(s.records()[0]).toMatchObject({ ip: '203.0.113.7', ua: 'Mozilla/5.0 test' })
  })

  test('a 5xx record carries the error code, message and the serialized error', () => {
    const s = setup()
    const c = ctx()
    s.log.onRequest(c)
    s.log.onError({ ...c, code: 'UNKNOWN', error: new Error('boom') })
    c.set.status = 500
    s.log.onAfterResponse({ ...c, response: { message: 'Internal error' } })

    const record = s.records()[0]
    expect(record.errorCode).toBe('UNKNOWN')
    expect(record.error.message).toBe('boom')
    expect(String(record.error.stack)).toContain('boom')
  })

  test('marks a request slow when it exceeds slowMs', () => {
    const s = setup({ slowMs: 100 })
    const c = ctx()
    s.log.onRequest(c)
    s.advance(250)
    s.log.onAfterResponse({ ...c, response: {} })
    expect(s.records()[0]).toMatchObject({ ms: 250, slow: true })
  })

  test('requestLogger binds the request id (and user once known) to business events', () => {
    const s = setup()
    const c = ctx()
    s.log.onRequest(c)
    s.log.onAfterHandle({ ...c, user: { id: 'u1' } })
    s.log.requestLogger(c.request).info('member.updated', { targetUserId: 'u2' })

    expect(s.records()[0]).toMatchObject({
      event: 'member.updated',
      requestId: 'fixed-id',
      userId: 'u1',
      targetUserId: 'u2',
    })
  })

  test('requestLogger falls back to the base logger with no pending request', () => {
    const s = setup()
    s.log.requestLogger(new Request('http://localhost/x')).info('script.run')
    expect(s.records()[0].event).toBe('script.run')
    expect(s.records()[0]).not.toHaveProperty('requestId')
  })

  test('a better-auth short-circuit is logged exactly once', () => {
    const s = setup()
    const c = ctx('http://localhost/api/auth/get-session')
    s.log.onRequest(c)
    const response = new Response('{}', { status: 200 })
    s.log.logShortCircuit(c.request, response)
    s.log.onAfterResponse({ ...c, response })

    expect(s.records()).toHaveLength(1)
    expect(s.records()[0]).toMatchObject({
      event: 'http.request',
      path: '/api/auth/get-session',
      status: 200,
    })
  })
})
