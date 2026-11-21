import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { rosterEntries } from '../../src/db/schema.ts'
import { getTeamBySlug } from '../../src/lib/teams.ts'
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

let captainA: string
let captainACookie: string
let memberA: string
let memberACookie: string
let disabledA: string
let disabledACookie: string
let captainB: string
let captainBCookie: string
let outsider: string
let outsiderCookie: string

beforeAll(async () => {
  ctx = await createTestContext()
  server = createTestApp(ctx)
  call = server.call

  const owner = await createUser(ctx, { name: 'Owner' })

  captainA = await createUser(ctx, { name: 'Captain A' })
  memberA = await createUser(ctx, { name: 'Member A' })
  disabledA = await createUser(ctx, { name: 'Disabled A' })
  captainB = await createUser(ctx, { name: 'Captain B' })
  outsider = await createUser(ctx, { name: 'Outsider' })

  const teamA = await seedTeam(ctx, { createdBy: owner, slug: 'alpha', name: 'Alpha' })
  const teamB = await seedTeam(ctx, { createdBy: owner, slug: 'bravo', name: 'Bravo' })

  await addMembership(ctx, { teamId: teamA, userId: captainA, role: 'captain', status: 'active' })
  await addMembership(ctx, { teamId: teamA, userId: memberA, role: 'member', status: 'active' })
  await addMembership(ctx, { teamId: teamA, userId: disabledA, role: 'member', status: 'disabled' })
  await addMembership(ctx, { teamId: teamB, userId: captainB, role: 'captain', status: 'active' })

  captainACookie = await createSessionCookie(ctx, captainA)
  memberACookie = await createSessionCookie(ctx, memberA)
  disabledACookie = await createSessionCookie(ctx, disabledA)
  captainBCookie = await createSessionCookie(ctx, captainB)
  outsiderCookie = await createSessionCookie(ctx, outsider)
})

afterAll(async () => {
  server.close()
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
    for (const path of [
      '/api/me',
      '/api/teams/alpha/roster',
      '/api/teams/alpha/invites',
      '/api/teams/alpha/members',
    ]) {
      expect((await call(path)).status).toBe(401)
    }
  })

  test('unknown api paths are JSON 404s, never the SPA', async () => {
    const res = await call('/api/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ message: 'Not found' })
  })
})

describe('accounts that are not members of the team', () => {
  test('/api/me reports no team and no status', async () => {
    const res = await call('/api/me', { cookie: outsiderCookie })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ teamId: null, teamSlug: null, status: null })
  })

  test('a team-less account gets 404, exactly like a stranger to that team', async () => {
    const res = await call('/api/teams/alpha/roster', { cookie: outsiderCookie })
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ message: 'Not found' })
  })

  test('an unknown slug is the same 404', async () => {
    expect((await call('/api/teams/nope/roster', { cookie: captainACookie })).status).toBe(404)
  })

  test('a disabled membership gets 403 on its own team', async () => {
    const res = await call('/api/teams/alpha/roster', { cookie: disabledACookie })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ message: 'Membership is not active' })
  })
})

describe('invites', () => {
  let inviteId: string
  let inviteCode: string

  test('a captain creates an invite with a copyable path', async () => {
    const res = await call('/api/teams/alpha/invites', {
      cookie: captainACookie,
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
    expect(invite.createdByName).toBe('Captain A')
  })

  test('a member cannot list invites', async () => {
    expect((await call('/api/teams/alpha/invites', { cookie: memberACookie })).status).toBe(403)
  })

  test('another team’s captain cannot see them either', async () => {
    expect((await call('/api/teams/alpha/invites', { cookie: captainBCookie })).status).toBe(404)
  })

  test('a captain sees the invite in the list', async () => {
    const res = await call('/api/teams/alpha/invites', { cookie: captainACookie })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject([{ id: inviteId, uses: 0, maxUses: 1 }])
  })

  test('claiming joins the team the code belongs to', async () => {
    const res = await call('/api/invites/claim', {
      cookie: outsiderCookie,
      method: 'POST',
      body: { code: inviteCode },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'active', teamSlug: 'alpha' })

    const me = await call('/api/me', { cookie: outsiderCookie })
    expect(await me.json()).toMatchObject({ status: 'active', teamSlug: 'alpha' })
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

  test('an unknown code is a 404', async () => {
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

  test('claiming while already active is a no-op', async () => {
    const res = await call('/api/invites/claim', {
      cookie: memberACookie,
      method: 'POST',
      body: { code: 'nosuchcode' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'active' })
  })

  test('revoking makes the code unusable', async () => {
    const created = (await (
      await call('/api/teams/alpha/invites', {
        cookie: captainACookie,
        method: 'POST',
        body: {},
      })
    ).json()) as { id: string; code: string }

    const revoke = await call(`/api/teams/alpha/invites/${created.id}/revoke`, {
      cookie: captainACookie,
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
  test('lists this team only — nobody from another team, nobody from no team', async () => {
    const stranger = await createUser(ctx, { name: 'Stranger, no team' })

    const res = await call('/api/teams/alpha/members', { cookie: captainACookie })
    expect(res.status).toBe(200)

    const ids = ((await res.json()) as { id: string }[]).map((entry) => entry.id)
    expect(ids).toContain(captainA)
    expect(ids).toContain(memberA)
    // an account with no membership is invisible, even to a captain
    expect(ids).not.toContain(stranger)
    // so is another team's captain
    expect(ids).not.toContain(captainB)
    // the outsider claimed alpha's invite earlier, so they belong here now
    expect(ids).toContain(outsider)
  })

  test('a member of another team is a 404 on PATCH', async () => {
    const res = await call(`/api/teams/alpha/members/${captainB}`, {
      cookie: captainACookie,
      method: 'PATCH',
      body: { role: 'member' },
    })
    expect(res.status).toBe(404)
  })

  test('the last active captain cannot be demoted', async () => {
    const res = await call(`/api/teams/alpha/members/${captainA}`, {
      cookie: captainACookie,
      method: 'PATCH',
      body: { role: 'member' },
    })

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      message: 'There has to be at least one active captain',
    })
  })

  test('a captain cannot disable themselves', async () => {
    const res = await call(`/api/teams/alpha/members/${captainA}`, {
      cookie: captainACookie,
      method: 'PATCH',
      body: { status: 'disabled' },
    })

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ message: 'You cannot disable your own account' })
  })

  test('disabling a member locks them out of the team', async () => {
    const res = await call(`/api/teams/alpha/members/${memberA}`, {
      cookie: captainACookie,
      method: 'PATCH',
      body: { status: 'disabled' },
    })
    expect(res.status).toBe(200)

    const blocked = await call('/api/teams/alpha/roster', { cookie: memberACookie })
    expect(blocked.status).toBe(403)
    expect(await blocked.json()).toMatchObject({ message: 'Membership is not active' })
  })

  test('a member cannot touch membership', async () => {
    const res = await call(`/api/teams/alpha/members/${captainA}`, {
      cookie: memberACookie,
      method: 'PATCH',
      body: { role: 'member' },
    })
    // disabled by the previous test, so the guard stops them one step earlier
    expect(res.status).toBe(403)
  })

  test('hasRosterEntry marks the member who is actually on the roster', async () => {
    const teamA = await getTeamBySlug(ctx.db, 'alpha')
    if (!teamA) throw new Error('alpha team missing')

    const linked = await createUser(ctx, { name: 'Linked' })
    const unlinked = await createUser(ctx, { name: 'Unlinked' })
    await addMembership(ctx, { teamId: teamA.id, userId: linked })
    await addMembership(ctx, { teamId: teamA.id, userId: unlinked })

    const now = new Date()
    await ctx.db.insert(rosterEntries).values({
      id: crypto.randomUUID(),
      teamId: teamA.id,
      userId: linked,
      note: null,
      roleOverride: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })

    const rows = (await (
      await call('/api/teams/alpha/members', { cookie: captainACookie })
    ).json()) as { id: string; hasRosterEntry: boolean }[]

    expect(rows.find((row) => row.id === linked)?.hasRosterEntry).toBe(true)
    expect(rows.find((row) => row.id === unlinked)?.hasRosterEntry).toBe(false)
  })
})
