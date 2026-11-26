import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
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
 * `GET /api/teams/:slug/pools` (champion-pools.md §7, §8, §11).
 *
 * The read is the half everybody gets: the whole roster, in roster order, with empty pools present.
 * The write and its owner-only guard land next; what is pinned here is that reading is a member
 * right and that the order is shared rather than per viewer.
 */
let ctx: TestContext
let server: TestServer
let call: TestServer['call']

let teamId: string
let captainId: string
let midId: string
let jglId: string
let topId: string
let outsiderCookie: string
let memberCookie: string

/** A roster row for a person. The captain owns these; the pool page only reads them for ordering. */
async function addToRoster(
  userId: string,
  roleOverride: 'TOP' | 'JGL' | 'MID' | 'ADC' | 'SUP' | null = null,
): Promise<void> {
  await ctx.db.execute(sql`
    insert into roster_entry
      ("id", "teamId", "userId", "roleOverride", "isActive", "createdAt", "updatedAt")
    values (${crypto.randomUUID()}, ${teamId}, ${userId}, ${roleOverride}, true, now(), now())
  `)
}

/** A saved pool: header row plus one entry per (kind, champion) pair, positions 0..n-1. */
async function savePool(
  ownerId: string,
  lists: { main?: number[]; situational?: number[]; blind?: number[]; wip?: number[] },
  version = 1,
): Promise<void> {
  await ctx.db.execute(sql`
    insert into pool ("ownerId", "version", "updatedAt") values (${ownerId}, ${version}, now())
    on conflict ("ownerId") do update set "version" = ${version}, "updatedAt" = now()
  `)

  for (const [kind, champions] of Object.entries(lists)) {
    for (const [position, championId] of (champions ?? []).entries()) {
      await ctx.db.execute(sql`
        insert into pool_entry
          ("id", "ownerId", "kind", "championId", "position", "createdAt", "updatedAt")
        values (${crypto.randomUUID()}, ${ownerId}, ${kind}, ${championId}, ${position}, now(), now())
      `)
    }
  }
}

const pools = async (cookie: string, slug = 'alpha'): Promise<PoolsDto> => {
  const response = await call(`/api/teams/${slug}/pools`, { cookie })
  expect(response.status).toBe(200)
  return (await response.json()) as PoolsDto
}

beforeAll(async () => {
  ctx = await createTestContext()
  server = createTestApp(ctx)
  call = server.call

  captainId = await createUser(ctx, { name: 'Captain' })
  topId = await createUser(ctx, { name: 'Anton' })
  jglId = await createUser(ctx, { name: 'Ben' })
  midId = await createUser(ctx, { name: 'Chris' })
  const outsiderId = await createUser(ctx, { name: 'Outsider' })

  teamId = await seedTeam(ctx, { createdBy: captainId, slug: 'alpha', name: 'Alpha' })
  await addMembership(ctx, { teamId, userId: captainId, role: 'captain' })
  for (const userId of [topId, jglId, midId]) await addMembership(ctx, { teamId, userId })

  // deliberately not in role order here: the page must sort, not the insertion order
  await addToRoster(midId, 'MID')
  await addToRoster(topId, 'TOP')
  await addToRoster(jglId, 'JGL')
  await addToRoster(captainId)

  memberCookie = await createSessionCookie(ctx, jglId)
  outsiderCookie = await createSessionCookie(ctx, outsiderId)
})

afterAll(async () => {
  server.close()
  await ctx.drop()
})

describe('guards', () => {
  test('reading needs a session', async () => {
    expect((await call('/api/teams/alpha/pools')).status).toBe(401)
  })

  test('a non-member sees the same 404 as a team that does not exist', async () => {
    expect((await call('/api/teams/alpha/pools', { cookie: outsiderCookie })).status).toBe(404)
    // a team that does not exist answers identically: the response cannot confirm another team
    const missing = await call('/api/teams/nope/pools', { cookie: memberCookie })
    expect(missing.status).toBe(404)
  })

  test('an ordinary member may read everyone', async () => {
    expect((await call('/api/teams/alpha/pools', { cookie: memberCookie })).status).toBe(200)
  })
})

describe('GET /pools', () => {
  test('every roster entry is present, in role order, with an empty pool each', async () => {
    const dto = await pools(memberCookie)

    expect(dto.people.map((person) => person.displayName)).toEqual([
      'Anton', // TOP
      'Ben', // JGL
      'Chris', // MID
      'Captain', // no role: after everyone with one
    ])
    for (const person of dto.people) {
      expect(person.lists).toEqual({ main: [], situational: [], blind: [], wip: [] })
      expect(person.version).toBe(0)
      expect(person.updatedAt).toBeNull()
    }
  })

  test('a saved pool reaches everyone in the shared order', async () => {
    await savePool(midId, { main: [103, 7, 245], situational: [13], blind: [103, 141] }, 4)

    const dto = await pools(memberCookie)
    const mid = dto.people.find((person) => person.userId === midId)

    expect(mid?.version).toBe(4)
    expect(mid?.lists).toEqual({
      main: [103, 7, 245],
      situational: [13],
      blind: [103, 141],
      wip: [],
    })
    expect(mid?.updatedAt).not.toBeNull()
  })

  test('one player’s pool never leaks into another’s column', async () => {
    const dto = await pools(memberCookie)
    const mid = dto.people.find((person) => person.userId === midId)
    const others = dto.people.filter((person) => person.userId !== midId)

    expect(mid?.lists.main).toEqual([103, 7, 245])
    for (const person of others)
      expect(person.lists).toEqual({ main: [], situational: [], blind: [], wip: [] })
  })

  test('a pool whose owner is not a member here does not appear', async () => {
    const strangerId = await createUser(ctx, { name: 'Stranger' })
    await savePool(strangerId, { main: [1] })

    const dto = await pools(memberCookie)
    expect(dto.people.some((person) => person.userId === strangerId)).toBe(false)
  })

  test('a member with a pool but no roster row still shows, at their own role position', async () => {
    // the captain has not added them yet; their pool must not be invisible (§7)
    const lateId = await createUser(ctx, { name: 'Late' })
    await addMembership(ctx, { teamId, userId: lateId })
    await ctx.db.execute(sql`
      insert into profile ("id", "userId", "displayName", "preferredRole", "updatedAt")
      values (${crypto.randomUUID()}, ${lateId}, 'Late', 'SUP', now())
    `)
    await savePool(lateId, { main: [5, 6] })

    const dto = await pools(memberCookie)

    // position order is roles TOP → SUP, then name, and the roleless last — so a SUP sits exactly
    // where they will sit once the roster row exists
    expect(dto.people.map((person) => person.displayName)).toEqual([
      'Anton', // TOP
      'Ben', // JGL
      'Chris', // MID
      'Late', // SUP, roster row still missing
      'Captain', // no role
    ])
    expect(dto.people.find((person) => person.userId === lateId)?.lists.main).toEqual([5, 6])
  })

  test('the learning list is read in its own order, next to the other three', async () => {
    // stored as raw rows on purpose: the read path must not depend on the write handler for wip
    const learnerId = await createUser(ctx, { name: 'Dana' })
    await addMembership(ctx, { teamId, userId: learnerId })
    await addToRoster(learnerId, 'SUP')
    await savePool(learnerId, { main: [7], wip: [245, 103] }, 2)

    const dto = await pools(memberCookie)
    const learner = dto.people.find((person) => person.userId === learnerId)

    expect(learner?.lists.wip).toEqual([245, 103])
    expect(learner?.lists.main).toEqual([7])
  })
})
