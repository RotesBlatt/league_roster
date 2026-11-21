import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { profile, riotAccounts, rosterEntries } from '../../src/db/schema.ts'
import type { RosterEntryDto } from '../../src/db/schema.types.ts'
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
 * `GET /api/teams/:slug/roster` — the join, not a copy (player-profiles.md §2).
 *
 * The point of the whole split is the test called *"a profile edit shows up without a sync step"*:
 * there is no copying job to run, because the roster is rendered from the player's own row.
 */
let ctx: TestContext
let server: TestServer
let call: TestServer['call']
let teamId: string
let captainCookie: string
let outsiderCookie: string

let captainId: string
let midId: string
let noProfileId: string

beforeAll(async () => {
  ctx = await createTestContext()
  server = createTestApp(ctx)
  call = server.call

  captainId = await createUser(ctx, { name: 'Captain' })
  midId = await createUser(ctx, { name: 'julius_dev' })
  noProfileId = await createUser(ctx, { name: 'No Profile Yet' })
  const outsiderId = await createUser(ctx, { name: 'Outsider' })

  teamId = await seedTeam(ctx, { createdBy: captainId, slug: 'alpha' })
  await addMembership(ctx, { teamId, userId: captainId, role: 'captain' })
  await addMembership(ctx, { teamId, userId: midId })
  await addMembership(ctx, { teamId, userId: noProfileId })

  captainCookie = await createSessionCookie(ctx, captainId)
  outsiderCookie = await createSessionCookie(ctx, outsiderId)

  const now = new Date('2026-01-01T00:00:00.000Z')
  await ctx.db.insert(profile).values({
    id: crypto.randomUUID(),
    userId: midId,
    displayName: 'Jules',
    preferredRole: 'MID',
    birthday: null,
    updatedAt: now,
  })
  await ctx.db.insert(riotAccounts).values([
    {
      id: crypto.randomUUID(),
      userId: midId,
      gameName: 'Smurf',
      tagLine: 'EUW',
      isMain: false,
      createdAt: now,
    },
    {
      id: crypto.randomUUID(),
      userId: midId,
      gameName: 'Hide on bush',
      tagLine: 'EUW',
      isMain: true,
      createdAt: now,
    },
  ])

  await ctx.db.insert(rosterEntries).values([
    {
      id: crypto.randomUUID(),
      teamId,
      userId: captainId,
      roleOverride: 'TOP',
      note: 'shotcaller',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: crypto.randomUUID(),
      teamId,
      userId: midId,
      note: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: crypto.randomUUID(),
      teamId,
      userId: noProfileId,
      note: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ])
})

afterAll(async () => {
  server.close()
  await ctx.drop()
})

const roster = async (cookie = captainCookie) =>
  (await (await call('/api/teams/alpha/roster', { cookie })).json()) as RosterEntryDto[]

describe('GET /api/teams/:slug/roster', () => {
  test('is closed to anonymous callers', async () => {
    expect((await call('/api/teams/alpha/roster')).status).toBe(401)
  })

  test('a non-member gets the same 404 as a team that does not exist', async () => {
    expect((await call('/api/teams/alpha/roster', { cookie: outsiderCookie })).status).toBe(404)
  })

  test('a member without a profile still appears, named by their Discord name', async () => {
    const rows = await roster()
    const row = rows.find((entry) => entry.userId === noProfileId)

    expect(row).toMatchObject({ displayName: 'No Profile Yet', role: null, mainAccount: null })
  })

  test('the row is the join: profile name, stated role, and only the main account', async () => {
    const row = (await roster()).find((entry) => entry.userId === midId)

    expect(row).toMatchObject({
      displayName: 'Jules',
      role: 'MID',
      note: null,
      isActive: true,
      mainAccount: { gameName: 'Hide on bush', tagLine: 'EUW', verifiedAt: null },
    })
  })

  test('the captain’s override wins over the stated preference', async () => {
    const row = (await roster()).find((entry) => entry.userId === captainId)

    expect(row).toMatchObject({ role: 'TOP', note: 'shotcaller' })
  })

  test('the list is in position order, unknown positions last', async () => {
    expect((await roster()).map((row) => row.displayName)).toEqual([
      'Captain',
      'Jules',
      'No Profile Yet',
    ])
  })

  test('a profile edit shows up without a sync step — that is the whole point of the split', async () => {
    const response = await call('/api/me/profile', {
      method: 'PUT',
      cookie: captainCookie,
      body: { displayName: 'Captain Renamed', preferredRole: 'SUP', birthday: null },
    })
    expect(response.status).toBe(200)

    const row = (await roster()).find((entry) => entry.userId === captainId)
    // the name follows the profile; the captain's own override on the roster still wins
    expect(row).toMatchObject({ displayName: 'Captain Renamed', role: 'TOP' })
  })
})
