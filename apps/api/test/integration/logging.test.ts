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
let captainCookie: string
let memberId: string
let memberCookie: string
let inviteId: string
let inviteCodeValue: string

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
  captainCookie = await createSessionCookie(ctx, captainId)
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
    // each denial emits auth.denied + http.request, so four lines for two requests
    await settle(before + 4)

    const emitted = since(before)
    expect(emitted.filter((record) => record.event === 'http.request')).toHaveLength(2)
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
    expect(
      since(before).find((record) => record.event === 'http.request' && record.path === '/api/me'),
    ).toMatchObject({ status: 200, userId: memberId })
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

describe('auth.denied', () => {
  test('a captain-only denial is a warn line with guard, reason and user', async () => {
    const before = records().length
    const res = await call(`/api/teams/alpha/members/${memberId}`, {
      method: 'PATCH',
      body: { role: 'member' },
      cookie: memberCookie,
    })
    expect(res.status).toBe(403)
    await settle(before + 2)

    const emitted = since(before)
    const denied = emitted.find((record) => record.event === 'auth.denied')
    const request = emitted.find((record) => record.event === 'http.request')
    expect(denied).toMatchObject({
      guard: 'teamCaptain',
      reason: 'captain_only',
      userId: memberId,
      level: 'warn',
    })
    // correlated with the request line that produced it
    expect(denied.requestId).toBe(request.id)
  })

  test('not signed in and not a member are info-level denials', async () => {
    const outsider = await createUser(ctx, { name: 'Outsider' })
    const outsiderCookie = await createSessionCookie(ctx, outsider)
    const before = records().length

    await call('/api/me')
    await call('/api/teams/alpha/players', { cookie: outsiderCookie })
    await settle(before + 4)

    const emitted = since(before)
    const notSignedIn = emitted.find((record) => record.reason === 'not_signed_in')
    const notMember = emitted.find((record) => record.reason === 'not_a_member')
    expect(notSignedIn).toMatchObject({ event: 'auth.denied', guard: 'auth', level: 'info' })
    expect(notMember).toMatchObject({
      event: 'auth.denied',
      guard: 'teamMember',
      reason: 'not_a_member',
      userId: outsider,
      level: 'info',
    })
  })

  test('an allowed request logs no denial', async () => {
    const before = records().length
    const res = await call('/api/me', { cookie: memberCookie })
    expect(res.status).toBe(200)
    await settle(before + 1)
    expect(since(before).some((record) => record.event === 'auth.denied')).toBe(false)
  })
})

describe('invite events', () => {
  test('creating an invite logs its id, never the code', async () => {
    const before = records().length
    const res = await call('/api/teams/alpha/invites', {
      method: 'POST',
      body: { maxUses: 1 },
      cookie: captainCookie,
    })
    expect(res.status).toBe(200)
    const invite = (await res.json()) as { id: string; code: string }
    inviteId = invite.id
    inviteCodeValue = invite.code

    await settle(before + 2)
    expect(since(before).find((record) => record.event === 'invite.created')).toMatchObject({
      inviteId,
      byUserId: captainId,
      maxUses: 1,
    })
    expect(lines.join('')).not.toContain(inviteCodeValue)
  })

  test('claiming logs the claim, and a spent code logs a rejection with a reason', async () => {
    const claimer = await createUser(ctx, { name: 'Claimer' })
    const claimerCookie = await createSessionCookie(ctx, claimer)
    const secondClaimer = await createUser(ctx, { name: 'Second Claimer' })
    const secondCookie = await createSessionCookie(ctx, secondClaimer)

    const before = records().length
    const claimed = await call('/api/invites/claim', {
      method: 'POST',
      body: { code: inviteCodeValue },
      cookie: claimerCookie,
    })
    expect(claimed.status).toBe(200)
    const spent = await call('/api/invites/claim', {
      method: 'POST',
      body: { code: inviteCodeValue },
      cookie: secondCookie,
    })
    expect(spent.status).toBe(410)
    await settle(before + 4)

    const emitted = since(before)
    expect(emitted.find((record) => record.event === 'invite.claimed')).toMatchObject({
      inviteId,
      userId: claimer,
      uses: 1,
      maxUses: 1,
    })
    expect(emitted.find((record) => record.event === 'invite.claim_rejected')).toMatchObject({
      event: 'invite.claim_rejected',
      userId: secondClaimer,
      inviteId,
      reason: 'used_up',
      level: 'warn',
    })
  })

  test('an unknown code is a not_found rejection without an invite id', async () => {
    // a team-less account, so the claim handler does not short-circuit on an active membership
    const stranger = await createUser(ctx, { name: 'Stranger' })
    const strangerCookie = await createSessionCookie(ctx, stranger)
    const before = records().length
    const res = await call('/api/invites/claim', {
      method: 'POST',
      body: { code: 'no-such-code' },
      cookie: strangerCookie,
    })
    expect(res.status).toBe(404)
    await settle(before + 2)

    const rejected = since(before).find((record) => record.event === 'invite.claim_rejected')
    expect(rejected).toMatchObject({ userId: stranger, reason: 'not_found' })
    expect(rejected).not.toHaveProperty('inviteId')
  })

  test('revoking logs the invite and who did it', async () => {
    const created = await call('/api/teams/alpha/invites', {
      method: 'POST',
      body: { maxUses: 2 },
      cookie: captainCookie,
    })
    const invite = (await created.json()) as { id: string }

    const before = records().length
    const res = await call(`/api/teams/alpha/invites/${invite.id}/revoke`, {
      method: 'POST',
      cookie: captainCookie,
    })
    expect(res.status).toBe(200)
    await settle(before + 2)

    expect(since(before).find((record) => record.event === 'invite.revoked')).toMatchObject({
      inviteId: invite.id,
      byUserId: captainId,
    })
  })
})
