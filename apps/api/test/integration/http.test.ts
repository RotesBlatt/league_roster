import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createSessionCookie,
  createTestApp,
  createTestContext,
  createUser,
  type TestContext,
  type TestServer,
} from './helpers.ts'

let ctx: TestContext
let server: TestServer
let call: TestServer['call']
let dist: string

let captain: string
let captainCookie: string
let member: string
let memberCookie: string
let pending: string
let pendingCookie: string

beforeAll(async () => {
  ctx = await createTestContext()

  dist = mkdtempSync(join(tmpdir(), 'lol-http-'))
  mkdirSync(join(dist, 'assets'), { recursive: true })
  await Bun.write(join(dist, 'index.html'), '<!doctype html><div id="root"></div>')
  await Bun.write(join(dist, 'assets', 'app-1.js'), 'console.log(1)')

  server = createTestApp(ctx, dist)
  call = server.call

  captain = await createUser(ctx, { name: 'Captain', role: 'captain', status: 'active' })
  member = await createUser(ctx, { name: 'Member', role: 'member', status: 'active' })
  pending = await createUser(ctx, { name: 'Pending' })
  captainCookie = await createSessionCookie(ctx, captain)
  memberCookie = await createSessionCookie(ctx, member)
  pendingCookie = await createSessionCookie(ctx, pending)
})

afterAll(async () => {
  server.close()
  rmSync(dist, { recursive: true, force: true })
  await ctx.drop()
})

describe('unauthenticated surface', () => {
  test('health is public', async () => {
    const res = await call('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })
  })

  test('better-auth endpoint answers', async () => {
    const res = await call('/api/auth/get-session')
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })

  test('guarded routes answer 401 without a cookie', async () => {
    for (const path of ['/api/me', '/api/players', '/api/invites', '/api/members']) {
      expect((await call(path)).status).toBe(401)
    }
  })

  test('unknown api paths are JSON 404s, never the SPA', async () => {
    const res = await call('/api/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ message: 'Not found' })
  })

  test('built assets are served with an immutable cache header', async () => {
    const res = await call('/assets/app-1.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('immutable')
  })

  test('missing assets are 404s', async () => {
    expect((await call('/assets/missing.js')).status).toBe(404)
  })

  test('client-side routes get the SPA shell', async () => {
    for (const path of ['/', '/roster', '/admin', '/join/abc123']) {
      const res = await call(path)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('id="root"')
    }
  })
})

describe('pending members are gated', () => {
  test('/api/me reports the pending state (that is how the SPA shows the waiting screen)', async () => {
    const res = await call('/api/me', { cookie: pendingCookie })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'pending', role: 'member' })
  })

  test('every member route answers 403 "Waiting for approval"', async () => {
    for (const path of ['/api/players', '/api/invites', '/api/members']) {
      const res = await call(path, { cookie: pendingCookie })
      expect(res.status).toBe(403)
      expect(await res.json()).toMatchObject({ message: 'Waiting for approval' })
    }
  })
})

describe('players', () => {
  test('a member can read the roster', async () => {
    const res = await call('/api/players', { cookie: memberCookie })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  test('a member cannot write the roster', async () => {
    const res = await call('/api/players', {
      cookie: memberCookie,
      method: 'POST',
      body: { displayName: 'Nope', role: 'MID' },
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ message: 'Captain only' })
  })

  test('a captain can add players, and empty strings become null', async () => {
    const res = await call('/api/players', {
      cookie: captainCookie,
      method: 'POST',
      body: {
        displayName: 'Faker',
        role: 'MID',
        riotGameName: 'Hide on bush',
        riotTagLine: 'EUW',
        note: '',
        isActive: true,
      },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      displayName: 'Faker',
      role: 'MID',
      note: null,
      isActive: true,
      userId: null,
    })
  })

  test('an unknown role is a validation error', async () => {
    const res = await call('/api/players', {
      cookie: captainCookie,
      method: 'POST',
      body: { displayName: 'Bad role', role: 'SUPPORT' },
    })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ message: 'Invalid input' })
  })

  test('the roster is ordered by position, not alphabetically', async () => {
    await call('/api/players', {
      cookie: captainCookie,
      method: 'POST',
      body: { displayName: 'Top laner', role: 'TOP' },
    })
    await call('/api/players', {
      cookie: captainCookie,
      method: 'POST',
      body: { displayName: 'ADC', role: 'ADC' },
    })

    const roles = (
      (await (await call('/api/players', { cookie: memberCookie })).json()) as {
        role: string
      }[]
    ).map((player) => player.role)

    expect(roles).toEqual(['TOP', 'MID', 'ADC'])
  })

  test('patching and deleting works for a captain', async () => {
    const created = (await (
      await call('/api/players', {
        cookie: captainCookie,
        method: 'POST',
        body: { displayName: 'Temporary', role: 'SUP' },
      })
    ).json()) as { id: string }

    const patched = await call(`/api/players/${created.id}`, {
      cookie: captainCookie,
      method: 'PATCH',
      body: { isActive: false },
    })
    expect(patched.status).toBe(200)
    // regression: t.UnionEnum injects its first value as a default, which used to rewrite
    // role to 'TOP' whenever a patch did not mention it
    expect(await patched.json()).toMatchObject({ isActive: false, role: 'SUP' })

    expect(
      (await call(`/api/players/${created.id}`, { cookie: captainCookie, method: 'DELETE' }))
        .status,
    ).toBe(200)
    expect(
      (
        await call(`/api/players/${created.id}`, {
          cookie: captainCookie,
          method: 'PATCH',
          body: { note: 'x' },
        })
      ).status,
    ).toBe(404)
  })
})

describe('invites', () => {
  let inviteId: string
  let inviteCode: string

  test('a captain creates an invite with a copyable path', async () => {
    const res = await call('/api/invites', {
      cookie: captainCookie,
      method: 'POST',
      body: { note: 'for the new guy', maxUses: 1, expiresInDays: 7 },
    })

    expect(res.status).toBe(200)
    const invite = (await res.json()) as {
      id: string
      code: string
      path: string
      createdByName: string
    }
    inviteId = invite.id
    inviteCode = invite.code

    expect(invite.code).toMatch(/^[a-z2-9]{8}$/)
    expect(invite.path).toBe(`/join/${invite.code}`)
    expect(invite.createdByName).toBe('Captain')
  })

  test('a member cannot list invites', async () => {
    expect((await call('/api/invites', { cookie: memberCookie })).status).toBe(403)
  })

  test('a captain sees the invite in the list', async () => {
    const res = await call('/api/invites', { cookie: captainCookie })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject([{ id: inviteId, uses: 0, maxUses: 1 }])
  })

  test('claiming activates a pending user', async () => {
    const res = await call('/api/invites/claim', {
      cookie: pendingCookie,
      method: 'POST',
      body: { code: inviteCode },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'active' })

    const me = await call('/api/me', { cookie: pendingCookie })
    expect(await me.json()).toMatchObject({ status: 'active' })
  })

  test('an exhausted invite is refused for the next user', async () => {
    const second = await createUser(ctx, { name: 'Second' })
    const secondCookie = await createSessionCookie(ctx, second)

    const res = await call('/api/invites/claim', {
      cookie: secondCookie,
      method: 'POST',
      body: { code: inviteCode },
    })

    expect(res.status).toBe(410)
    expect(await res.json()).toMatchObject({ message: 'This invite is used up' })
  })

  test('an unknown code is a 404 for a pending user', async () => {
    const stranger = await createUser(ctx, { name: 'Stranger' })
    const strangerCookie = await createSessionCookie(ctx, stranger)

    const res = await call('/api/invites/claim', {
      cookie: strangerCookie,
      method: 'POST',
      body: { code: 'nosuchcode' },
    })
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ message: 'Invite not found' })
  })

  test('claiming while already approved is a no-op', async () => {
    const res = await call('/api/invites/claim', {
      cookie: memberCookie,
      method: 'POST',
      body: { code: 'nosuchcode' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'active' })
  })

  test('revoking makes the code unusable', async () => {
    const created = (await (
      await call('/api/invites', { cookie: captainCookie, method: 'POST', body: {} })
    ).json()) as { id: string; code: string }

    const revoke = await call(`/api/invites/${created.id}/revoke`, {
      cookie: captainCookie,
      method: 'POST',
    })
    expect(revoke.status).toBe(200)

    const late = await createUser(ctx, { name: 'Late' })
    const lateCookie = await createSessionCookie(ctx, late)
    const claim = await call('/api/invites/claim', {
      cookie: lateCookie,
      method: 'POST',
      body: { code: created.code },
    })

    expect(claim.status).toBe(410)
    expect(await claim.json()).toMatchObject({ message: 'This invite was revoked' })
  })
})

describe('members', () => {
  test('the approval queue lists pending accounts', async () => {
    const waiting = await createUser(ctx, { name: 'Waiting' })
    const res = await call('/api/members', { cookie: captainCookie })

    expect(res.status).toBe(200)
    const members = (await res.json()) as { id: string; status: string }[]
    expect(members.find((entry) => entry.id === waiting)).toMatchObject({ status: 'pending' })
  })

  test('approving a pending account activates it', async () => {
    const waiting = await createUser(ctx, { name: 'Approve me' })
    const res = await call(`/api/members/${waiting}`, {
      cookie: captainCookie,
      method: 'PATCH',
      body: { status: 'active' },
    })

    expect(res.status).toBe(200)
    expect(
      await (await call('/api/me', { cookie: await createSessionCookie(ctx, waiting) })).json(),
    ).toMatchObject({
      status: 'active',
    })
  })

  test('the last active captain cannot be demoted', async () => {
    const res = await call(`/api/members/${captain}`, {
      cookie: captainCookie,
      method: 'PATCH',
      body: { role: 'member' },
    })

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      message: 'There has to be at least one active captain',
    })
  })

  test('a captain cannot disable themselves', async () => {
    const res = await call(`/api/members/${captain}`, {
      cookie: captainCookie,
      method: 'PATCH',
      body: { status: 'disabled' },
    })

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ message: 'You cannot disable your own account' })
  })

  test('a member cannot touch membership', async () => {
    const res = await call(`/api/members/${captain}`, {
      cookie: memberCookie,
      method: 'PATCH',
      body: { role: 'member' },
    })
    expect(res.status).toBe(403)
  })
})
