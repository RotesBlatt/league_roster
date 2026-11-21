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

    expect(row).toMatchObject({ displayName: 'No Profile Yet', role: null, account: null })
  })

  test('the row is the join: profile name, stated role, and only the main account', async () => {
    const row = (await roster()).find((entry) => entry.userId === midId)

    expect(row).toMatchObject({
      displayName: 'Jules',
      role: 'MID',
      note: null,
      isActive: true,
      account: {
        id: expect.any(String),
        gameName: 'Hide on bush',
        tagLine: 'EUW',
        verifiedAt: null,
        isMain: true,
      },
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

describe('captain writes on the roster', () => {
  let extraId: string
  let memberCookie: string
  let entryId: string

  const post = (body: unknown, cookie = captainCookie) =>
    call('/api/teams/alpha/roster', { method: 'POST', body, cookie })
  const patch = (id: string, body: unknown, cookie = captainCookie) =>
    call(`/api/teams/alpha/roster/${id}`, { method: 'PATCH', body, cookie })
  const remove = (id: string, cookie = captainCookie) =>
    call(`/api/teams/alpha/roster/${id}`, { method: 'DELETE', cookie })

  beforeAll(async () => {
    // a member who is not on the roster yet, and a plain member to prove the captain guard
    extraId = await createUser(ctx, { name: 'Extra Member' })
    await addMembership(ctx, { teamId, userId: extraId })

    // two accounts: the main one, and the one he actually plays for this team
    await ctx.db.insert(riotAccounts).values([
      {
        id: `acc-main-${extraId}`,
        userId: extraId,
        gameName: 'Main Account',
        tagLine: 'EUW',
        isMain: true,
        createdAt: new Date(),
      },
      {
        id: `acc-team-${extraId}`,
        userId: extraId,
        gameName: 'Team Account',
        tagLine: 'EUW',
        isMain: false,
        createdAt: new Date(),
      },
    ])
    memberCookie = await createSessionCookie(ctx, midId)
  })

  test('is closed to anonymous callers', async () => {
    expect((await post({ userId: extraId }, '')).status).toBe(401)
  })

  test('a plain member cannot write — captain only', async () => {
    expect((await post({ userId: extraId }, memberCookie)).status).toBe(403)
  })

  test('adding a member puts them on the roster', async () => {
    const response = await post({ userId: extraId, note: 'sub' })

    expect(response.status).toBe(200)
    const row = (await roster()).find((entry) => entry.userId === extraId)
    expect(row).toMatchObject({ displayName: 'Extra Member', note: 'sub', isActive: true })
  })

  test('somebody who is not a member of this team cannot be added', async () => {
    const outsider = await createUser(ctx, { name: 'Not A Member' })
    const response = await post({ userId: outsider })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ message: expect.stringContaining('member') })
  })

  test('the same member twice is a conflict, not a second row', async () => {
    const response = await post({ userId: extraId })

    expect(response.status).toBe(409)
  })

  test('an unknown role override is a field error', async () => {
    const row = (await roster()).find((entry) => entry.userId === extraId)
    entryId = row?.id ?? ''

    const response = await patch(entryId, { roleOverride: 'JUNGLE' })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ details: [{ path: 'roleOverride' }] })
  })

  test('the member list offers his accounts, main first', async () => {
    const members = (await (
      await call('/api/teams/alpha/members', { cookie: captainCookie })
    ).json()) as { id: string; accounts: { id: string; gameName: string; isMain: boolean }[] }[]

    const extra = members.find((member) => member.id === extraId)
    expect(extra?.accounts.map((account) => account.gameName)).toEqual([
      'Main Account',
      'Team Account',
    ])
    expect(extra?.accounts[0]?.isMain).toBe(true)
  })

  test('adding a member defaults to his main account', async () => {
    const row = (await roster()).find((entry) => entry.userId === extraId)

    expect(row?.account).toMatchObject({ gameName: 'Main Account', isMain: true })
  })

  test('the captain can pick the account this team uses — his main is not it', async () => {
    const row = (await roster()).find((entry) => entry.userId === extraId)
    entryId = row?.id ?? ''

    const response = await patch(entryId, { accountId: `acc-team-${extraId}` })
    expect(response.status).toBe(200)

    expect((await roster()).find((entry) => entry.userId === extraId)?.account).toMatchObject({
      gameName: 'Team Account',
      isMain: false,
    })
  })

  test('an account of somebody else is refused, not silently written', async () => {
    const response = await patch(entryId, { accountId: 'acc-main-not-mine' })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ message: expect.stringContaining('account') })
    // and the previous choice is untouched
    expect((await roster()).find((entry) => entry.userId === extraId)?.account).toMatchObject({
      gameName: 'Team Account',
    })
  })

  test('the note and the override can be set, and the override cleared again', async () => {
    expect((await patch(entryId, { note: '  sub  ', roleOverride: 'SUP' })).status).toBe(200)
    expect((await roster()).find((entry) => entry.userId === extraId)).toMatchObject({
      note: 'sub',
      role: 'SUP',
    })

    // explicit null = back to what the player stated (none here), not "leave it"
    expect((await patch(entryId, { roleOverride: null })).status).toBe(200)
    expect((await roster()).find((entry) => entry.userId === extraId)?.role).toBeNull()
  })

  test('isActive can be switched off without touching the position', async () => {
    expect((await patch(entryId, { isActive: false, roleOverride: 'ADC' })).status).toBe(200)
    expect((await roster()).find((entry) => entry.userId === extraId)).toMatchObject({
      isActive: false,
      role: 'ADC',
    })
  })

  test('a member leaving the roster is a delete, and an unknown id is a 404', async () => {
    expect((await remove(entryId)).status).toBe(200)
    expect((await roster()).map((entry) => entry.userId)).not.toContain(extraId)

    expect((await remove(entryId)).status).toBe(404)
  })
})
