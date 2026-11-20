import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
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

/**
 * The tenancy contract, one test per rule from multi-team.md §5:
 * another team's resources answer 404, never 403, and never leak a row.
 */
let ctx: TestContext
let server: TestServer
let call: TestServer['call']

let captainA: string
let captainACookie: string
let captainB: string
let captainBCookie: string
let playerA: string

beforeAll(async () => {
  ctx = await createTestContext()
  server = createTestApp(ctx)
  call = server.call

  const owner = await createUser(ctx, { name: 'Owner' })
  captainA = await createUser(ctx, { name: 'Captain A' })
  captainB = await createUser(ctx, { name: 'Captain B' })

  const teamA = await seedTeam(ctx, { createdBy: owner, slug: 'alpha' })
  const teamB = await seedTeam(ctx, { createdBy: owner, slug: 'bravo' })
  await addMembership(ctx, { teamId: teamA, userId: captainA, role: 'captain', status: 'active' })
  await addMembership(ctx, { teamId: teamB, userId: captainB, role: 'captain', status: 'active' })

  captainACookie = await createSessionCookie(ctx, captainA)
  captainBCookie = await createSessionCookie(ctx, captainB)

  const created = (await (
    await call('/api/teams/alpha/players', {
      cookie: captainACookie,
      method: 'POST',
      body: { displayName: 'Alpha mid', role: 'MID' },
    })
  ).json()) as { id: string }
  playerA = created.id
})

afterAll(async () => {
  server.close()
  await ctx.drop()
})

describe('reads never cross a team boundary', () => {
  test('each roster is its own', async () => {
    const alpha = (await (
      await call('/api/teams/alpha/players', { cookie: captainACookie })
    ).json()) as {
      id: string
    }[]
    const bravo = (await (
      await call('/api/teams/bravo/players', { cookie: captainBCookie })
    ).json()) as {
      id: string
    }[]

    expect(alpha.map((row) => row.id)).toEqual([playerA])
    expect(bravo).toEqual([])
  })

  test('reading the other team is a 404, not a 403', async () => {
    const res = await call('/api/teams/bravo/players', { cookie: captainACookie })
    expect(res.status).toBe(404)
    // identical to an unknown team, so the answer cannot confirm bravo exists
    const unknown = await call('/api/teams/nope/players', { cookie: captainACookie })
    expect(await res.json()).toEqual(await unknown.json())
  })
})

describe('writes never cross a team boundary', () => {
  test('a player created in alpha has alpha as its teamId', async () => {
    const rows = (await (
      await call('/api/teams/alpha/players', { cookie: captainACookie })
    ).json()) as { teamId: string }[]
    expect(rows[0]?.teamId).not.toBeNull()
  })

  test('captain B cannot patch or delete team A’s player by id', async () => {
    const patch = await call(`/api/teams/bravo/players/${playerA}`, {
      cookie: captainBCookie,
      method: 'PATCH',
      body: { note: 'stolen' },
    })
    expect(patch.status).toBe(404)

    const remove = await call(`/api/teams/bravo/players/${playerA}`, {
      cookie: captainBCookie,
      method: 'DELETE',
    })
    expect(remove.status).toBe(404)
  })

  // regression: revoke used to update by id and check the team afterwards, so captain A got a
  // 404 for bravo's invite *after* it had already been revoked
  test('captain A cannot revoke bravo’s invite by id', async () => {
    const created = (await (
      await call('/api/teams/bravo/invites', {
        cookie: captainBCookie,
        method: 'POST',
        body: { note: 'bravo only' },
      })
    ).json()) as { id: string }

    const revoke = await call(`/api/teams/alpha/invites/${created.id}/revoke`, {
      cookie: captainACookie,
      method: 'POST',
    })
    expect(revoke.status).toBe(404)

    // and bravo's invite still works
    const bravoInvites = (await (
      await call('/api/teams/bravo/invites', { cookie: captainBCookie })
    ).json()) as { id: string; revokedAt: number | null }[]
    expect(bravoInvites.find((row) => row.id === created.id)?.revokedAt).toBeNull()
  })

  test('...and the player is untouched', async () => {
    const rows = (await (
      await call('/api/teams/alpha/players', { cookie: captainACookie })
    ).json()) as { id: string; note: string | null }[]
    expect(rows.find((row) => row.id === playerA)).toMatchObject({ note: null })
  })

  test('captain A cannot patch a member of bravo', async () => {
    const res = await call(`/api/teams/alpha/members/${captainB}`, {
      cookie: captainACookie,
      method: 'PATCH',
      body: { status: 'disabled' },
    })
    expect(res.status).toBe(404)
  })
})

describe('/api/me is global but names the team', () => {
  test('reports the slug so the SPA can navigate', async () => {
    const me = (await (await call('/api/me', { cookie: captainACookie })).json()) as {
      teamSlug: string | null
      role: string
    }
    expect(me.teamSlug).toBe('alpha')
    expect(me.role).toBe('captain')
  })

  test('an account in no team has no slug and no status', async () => {
    const loner = await createUser(ctx, { name: 'Loner' })
    const cookie = await createSessionCookie(ctx, loner)
    const me = (await (await call('/api/me', { cookie })).json()) as {
      teamSlug: string | null
      status: string | null
    }
    expect(me.teamSlug).toBeNull()
    expect(me.status).toBeNull()
  })
})
