import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLogger } from '../../src/lib/log/logger.ts'
import {
  addMembership,
  createSessionCookie,
  createTestApp,
  createTestContext,
  createUser,
  seedTeam,
  type TestContext,
  type TestServer,
} from './helpers.ts'

let ctx: TestContext
let server: TestServer
let call: TestServer['call']
let captainId: string
let memberId: string
let memberCookie: string

const lines: string[] = []

function records() {
  return lines
    .join('')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function since(count: number) {
  return records().slice(count)
}

/** `onAfterResponse` runs after the client already has the response; wait for its line. */
async function settle(expected: number): Promise<void> {
  const start = Date.now()
  while (records().length < expected) {
    if (Date.now() - start > 3000) {
      throw new Error(`expected ${expected} log lines, saw ${records().length}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

beforeAll(async () => {
  ctx = await createTestContext()

  const spaDir = mkdtempSync(join(tmpdir(), 'spa-'))
  writeFileSync(join(spaDir, 'index.html'), '<!doctype html><title>spa</title>')

  const logger = createLogger({
    level: 'debug',
    destination: {
      write(chunk) {
        lines.push(chunk)
      },
    },
  })
  server = createTestApp(ctx, spaDir, logger)
  call = server.call

  const owner = await createUser(ctx, { name: 'Owner' })
  captainId = await createUser(ctx, { name: 'Captain' })
  memberId = await createUser(ctx, { name: 'Member' })
  const team = await seedTeam(ctx, { createdBy: owner, slug: 'alpha', name: 'Alpha' })
  await addMembership(ctx, { teamId: team, userId: captainId, role: 'captain' })
  await addMembership(ctx, { teamId: team, userId: memberId, role: 'member' })
  memberCookie = await createSessionCookie(ctx, memberId)
})

afterAll(async () => {
  server.close()
  await ctx.drop()
})

describe('request logging', () => {
  test('one http.request per call, with method, path, status, ms and an echoed id', async () => {
    const before = records().length
    const res = await call('/api/health')
    expect(res.status).toBe(200)
    await settle(before + 1)

    const emitted = since(before)
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      event: 'http.request',
      method: 'GET',
      path: '/api/health',
      status: 200,
      level: 'info',
    })
    expect(typeof emitted[0].ms).toBe('number')
    expect(emitted[0].id).toMatch(/^[0-9a-f]{8}$/)
    expect(res.headers.get('x-request-id')).toBe(emitted[0].id)
  })

  test('401 and 403 are warn lines carrying the API message', async () => {
    const before = records().length
    const unauthorized = await call('/api/me')
    expect(unauthorized.status).toBe(401)

    const denied = await call(`/api/teams/alpha/members/${captainId}`, {
      method: 'PATCH',
      body: { role: 'member' },
      cookie: memberCookie,
    })
    expect(denied.status).toBe(403)
    await settle(before + 2)

    const emitted = since(before)
    expect(emitted).toHaveLength(2)
    const me = emitted.find((record) => record.path === '/api/me')
    const member = emitted.find((record) => record.path === `/api/teams/alpha/members/${captainId}`)
    expect(me).toMatchObject({ path: '/api/me', status: 401, level: 'warn' })
    expect(member).toMatchObject({
      method: 'PATCH',
      path: `/api/teams/alpha/members/${captainId}`,
      status: 403,
      level: 'warn',
      message: 'Captain only',
    })
  })

  test('an authenticated call carries the userId', async () => {
    const before = records().length
    const res = await call('/api/me', { cookie: memberCookie })
    expect(res.status).toBe(200)
    await settle(before + 1)
    expect(since(before)[0]).toMatchObject({ path: '/api/me', status: 200, userId: memberId })
  })

  test('a validation failure is a 422 warn', async () => {
    const before = records().length
    const res = await call('/api/teams', { method: 'POST', body: {}, cookie: memberCookie })
    expect(res.status).toBe(422)
    await settle(before + 1)
    expect(since(before)[0]).toMatchObject({ status: 422, level: 'warn', message: 'Invalid input' })
  })

  test('an unknown /api path is a 404; a deep link is the 200 SPA shell', async () => {
    const before = records().length
    const missing = await call('/api/nope')
    const page = await call('/roster')
    expect(missing.status).toBe(404)
    expect(page.status).toBe(200)
    await settle(before + 2)

    const emitted = since(before)
    expect(emitted).toHaveLength(2)
    expect(emitted.find((record) => record.path === '/api/nope')).toMatchObject({
      path: '/api/nope',
      status: 404,
      level: 'warn',
    })
    expect(emitted.find((record) => record.path === '/roster')).toMatchObject({
      path: '/roster',
      status: 200,
      level: 'info',
    })
  })

  test('better-auth is logged exactly once (the onRequest short-circuit)', async () => {
    const before = records().length
    const res = await call('/api/auth/get-session')
    expect(res.status).toBe(200)
    await settle(before + 1)

    const emitted = since(before)
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ path: '/api/auth/get-session', status: 200 })
  })

  test('the session cookie value never reaches a log line', async () => {
    const before = records().length
    await call('/api/me', { cookie: memberCookie })
    await settle(before + 1)
    const haystack = lines.join('')
    const secret = memberCookie.slice(memberCookie.indexOf('=') + 1)
    expect(haystack).not.toContain(secret)
    expect(haystack).not.toContain('better-auth.session_token')
  })
})
