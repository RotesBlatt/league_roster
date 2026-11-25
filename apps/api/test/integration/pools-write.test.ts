import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { poolEntries } from '../../src/db/schema.ts'
import type { PoolsDto } from '../../src/db/schema.types.ts'
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
 * `PUT /api/pools` — writing your own pool (champion-pools.md §5, §6, §8).
 *
 * The failure this is written against is the silent one: a write that half-lands, a stale tab that
 * overwrites a rearrangement without an error, or a reorder that trips a unique constraint on the
 * way. So the assertions are about what the *next read* says, not about the 200.
 */
let ctx: TestContext
let server: TestServer
let call: TestServer['call']

let teamId: string
let meId: string
let teammateId: string
let meCookie: string
let teammateCookie: string

async function addToRoster(userId: string, role: 'TOP' | 'MID'): Promise<void> {
  await ctx.db.execute(sql`
    insert into roster_entry
      ("id", "teamId", "userId", "roleOverride", "isActive", "createdAt", "updatedAt")
    values (${crypto.randomUUID()}, ${teamId}, ${userId}, ${role}, true, now(), now())
  `)
}

type Lists = { main?: number[]; situational?: number[]; blind?: number[] }

/** The full body: three lists always, because the endpoint writes the whole pool. */
const body = (version: number, lists: Lists) => ({
  version,
  lists: { main: lists.main ?? [], situational: lists.situational ?? [], blind: lists.blind ?? [] },
})

const put = (cookie: string | undefined, payload: unknown) =>
  call('/api/pools', {
    method: 'PUT',
    ...(cookie ? { cookie } : {}),
    body: payload as Record<string, unknown>,
  })

const pools = async (): Promise<PoolsDto> => {
  const response = await call('/api/teams/alpha/pools', { cookie: teammateCookie })
  expect(response.status).toBe(200)
  return (await response.json()) as PoolsDto
}

const person = async (userId: string) => {
  const dto = await pools()
  const found = dto.people.find((row) => row.userId === userId)
  if (!found) throw new Error(`no pool row for ${userId}`)
  return found
}

/** Row count for one owner, read raw: "nothing was written" must not be inferred from the DTO. */
const entryCount = async (ownerId: string): Promise<number> => {
  const rows = await ctx.db.execute<{ count: string }>(sql`
    select count(*)::text as count from pool_entry where "ownerId" = ${ownerId}
  `)
  return Number(rows[0]?.count ?? '0')
}

beforeAll(async () => {
  ctx = await createTestContext()
  server = createTestApp(ctx)
  call = server.call

  meId = await createUser(ctx, { name: 'Me' })
  teammateId = await createUser(ctx, { name: 'Mate' })

  teamId = await seedTeam(ctx, { createdBy: meId, slug: 'alpha', name: 'Alpha' })
  await addMembership(ctx, { teamId, userId: meId, role: 'captain' })
  await addMembership(ctx, { teamId, userId: teammateId })
  await addToRoster(meId, 'TOP')
  await addToRoster(teammateId, 'MID')

  meCookie = await createSessionCookie(ctx, meId)
  teammateCookie = await createSessionCookie(ctx, teammateId)
})

afterAll(async () => {
  server.close()
  await ctx.drop()
})

describe('guards', () => {
  test('writing needs a session', async () => {
    expect((await put(undefined, body(0, { main: [1] }))).status).toBe(401)
  })

  test('a signed-in person with no team can still write their own pool', async () => {
    const lonerId = await createUser(ctx, { name: 'Loner' })
    const lonerCookie = await createSessionCookie(ctx, lonerId)

    const response = await put(lonerCookie, body(0, { main: [1] }))
    expect(response.status).toBe(200)
    expect(await entryCount(lonerId)).toBe(1)
  })

  test('a forged ownerId cannot redirect the write to someone else', async () => {
    const senderId = await createUser(ctx, { name: 'Sender' })
    const senderCookie = await createSessionCookie(ctx, senderId)
    const victimId = await createUser(ctx, { name: 'Victim' })

    const response = await put(senderCookie, { ...body(0, { main: [1] }), ownerId: victimId })

    // whatever the validator makes of the extra key, the write must never land on the victim:
    // the owner comes from the session, never from the body
    expect(await entryCount(victimId)).toBe(0)
    expect(response.status).toBe(200)
    expect(await entryCount(senderId)).toBe(1)
  })
})

describe('PUT /api/pools', () => {
  test('a first write stores the three lists and returns version 1', async () => {
    const response = await put(meCookie, body(0, { main: [103, 7], situational: [13], blind: [7] }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ version: 1 })

    const written = await person(meId)
    expect(written.version).toBe(1)
    expect(written.lists).toEqual({ main: [103, 7], situational: [13], blind: [7] })
    expect(written.updatedAt).not.toBeNull()
  })

  test('a reorder forward and back is just another write — no constraint in the way', async () => {
    // [103,7] -> [7,103] -> [103,7], each as a whole-list write
    expect((await put(meCookie, body(1, { main: [7, 103] }))).status).toBe(200)
    expect((await person(meId)).lists.main).toEqual([7, 103])

    expect((await put(meCookie, body(2, { main: [103, 7] }))).status).toBe(200)
    expect((await person(meId)).lists.main).toEqual([103, 7])
  })

  test('the same champion in main and situational becomes one row, moved', async () => {
    const response = await put(meCookie, body(3, { main: [103], situational: [7] }))
    expect(response.status).toBe(200)

    const written = await person(meId)
    expect(written.lists.main).toEqual([103])
    expect(written.lists.situational).toEqual([7])

    const rows = await ctx.db.select().from(poolEntries).where(eq(poolEntries.ownerId, meId))
    expect(rows.filter((row) => row.championId === 7)).toHaveLength(1)
  })

  test('an empty list clears that kind and only that kind', async () => {
    expect((await put(meCookie, body(4, { main: [103] }))).status).toBe(200)

    const written = await person(meId)
    expect(written.lists).toEqual({ main: [103], situational: [], blind: [] })
  })

  test('a stale version is a 409 and writes nothing at all', async () => {
    const response = await put(meCookie, body(1, { main: [999] }))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ reason: 'stale', version: 5 })
    // the old content, not the rejected one, and no partial write
    expect((await person(meId)).lists).toEqual({ main: [103], situational: [], blind: [] })
    expect((await person(meId)).version).toBe(5)
  })

  test('everyone sees the reordered list: the order is not per viewer', async () => {
    expect((await put(meCookie, body(5, { main: [245, 103] }))).status).toBe(200)

    const asTeammate = await person(meId)
    expect(asTeammate.lists.main).toEqual([245, 103])
  })

  test('a duplicate within a kind is a 422 and leaves the stored pool untouched', async () => {
    const response = await put(meCookie, body(6, { main: [1, 1] }))

    expect(response.status).toBe(422)
    expect((await person(meId)).lists.main).toEqual([245, 103])
    expect((await person(meId)).version).toBe(6)
  })

  test('a champion in main and situational at once is refused', async () => {
    const response = await put(meCookie, body(6, { main: [1], situational: [1] }))

    expect(response.status).toBe(422)
    expect((await person(meId)).lists).toEqual({ main: [245, 103], situational: [], blind: [] })
  })

  test('more than the cap is refused', async () => {
    const tooMany = Array.from({ length: 16 }, (_, index) => index + 1)
    expect((await put(meCookie, body(6, { main: tooMany }))).status).toBe(422)
  })

  test('a write that changes nothing still bumps the version', async () => {
    const before = (await person(meId)).version
    // a write that changes nothing still counts: it is the statement "this is my pool"
    expect((await put(meCookie, body(before, { main: [245, 103] }))).status).toBe(200)
    expect((await person(meId)).version).toBe(before + 1)
  })
})
