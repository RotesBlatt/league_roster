import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import type { MatchGamesPage } from '../../src/db/schema.types.ts'
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
 * A team's human tag on a game (match-history.md §6, §5.5).
 *
 * `match_annotation` is per **team**, and the resolution order is fixed:
 * `tournament.kind → taggedKind → queueId → 'other'`. Two things are under test here and nothing
 * else: a tag *wins* over the queue id, and another team's tag never reaches this team — the same
 * tenancy rule as the games themselves, one table over.
 */
let ctx: TestContext
let server: TestServer
let call: TestServer['call']

let teamAId: string
let teamBId: string
let slugA: string
let captainA: string
let captainB: string
let cookieA: string
let puuidA: string
let puuidB: string

let flexId: string
let taggedByAId: string
let taggedByBOnlyId: string

async function addAccount(userId: string, label: string): Promise<string> {
  const puuid = `puuid-${label}`
  await ctx.db.execute(sql`
    insert into riot_account ("id", "userId", "gameName", "tagLine", "puuid", "createdAt")
    values (${crypto.randomUUID()}, ${userId}, ${label}, 'EUW', ${puuid}, now())
  `)
  return puuid
}

async function seedFlexMatch(riotMatchId: string, participants: string[]): Promise<string> {
  const id = crypto.randomUUID()
  await ctx.db.execute(sql`
    insert into "match"
      ("id", "source", "riotMatchId", "platformId", "gameStartAt", "durationSeconds",
       "queueId", "gameType", "fetchedAt")
    values (${id}, 'riot', ${riotMatchId}, 'euw1', now() - interval '1 hour', 1800,
            440, 'MATCHED_GAME', now())
  `)
  for (const [index, puuid] of participants.entries()) {
    await ctx.db.execute(sql`
      insert into match_participant
        ("id", "matchId", "side", "slot", "puuid", "teamPosition", "championId", "win")
      values (${crypto.randomUUID()}, ${id}, ${index + 1 <= 5 ? 100 : 200},
              ${index + 1}, ${puuid}, 'TOP', ${index + 1}, true)
    `)
  }
  return id
}

async function tag(matchId: string, teamId: string, kind: string, note: string | null) {
  await ctx.db.execute(sql`
    insert into match_annotation ("matchId", "teamId", "taggedKind", "note", "updatedAt")
    values (${matchId}, ${teamId}, ${kind}, ${note}, now())
  `)
}

const games = async (query: string, cookie = cookieA): Promise<MatchGamesPage> => {
  const response = await call(`/api/teams/${slugA}/matches${query}`, { cookie })
  expect(response.status).toBe(200)
  return (await response.json()) as MatchGamesPage
}

beforeAll(async () => {
  ctx = await createTestContext()
  server = createTestApp(ctx)
  call = server.call

  captainA = await createUser(ctx, { name: 'Captain A' })
  slugA = `a-${crypto.randomUUID().slice(0, 8)}`
  teamAId = await seedTeam(ctx, { createdBy: captainA, slug: slugA, name: 'Team A' })
  await addMembership(ctx, { teamId: teamAId, userId: captainA, role: 'captain' })

  captainB = await createUser(ctx, { name: 'Captain B' })
  const slugB = `b-${crypto.randomUUID().slice(0, 8)}`
  teamBId = await seedTeam(ctx, { createdBy: captainB, slug: slugB, name: 'Team B' })
  await addMembership(ctx, { teamId: teamBId, userId: captainB, role: 'captain' })

  puuidA = await addAccount(captainA, 'captain-a')
  puuidB = await addAccount(captainB, 'captain-b')
  cookieA = await createSessionCookie(ctx, captainA)

  // both of us in one game: the fixture that proves a tag is per team, not per game
  taggedByBOnlyId = await seedFlexMatch('EUW1_TAG_B', [puuidA, puuidB])
  await tag(taggedByBOnlyId, teamBId, 'tournament', 'their note')

  // a game only we were in, tagged by us
  taggedByAId = await seedFlexMatch('EUW1_TAG_A', [puuidA])
  await tag(taggedByAId, teamAId, 'scrim', 'our note')

  flexId = await seedFlexMatch('EUW1_PLAIN', [puuidA])
})

afterAll(async () => {
  server.close()
  await ctx.drop()
})

describe('a tag wins over the queue id (§6)', () => {
  test('our scrim-tagged Flex game reads as Scrim, not Flex', async () => {
    const page = await games('')
    const row = page.games.find((game) => game.matchId === taggedByAId)
    expect(row?.kind).toBe('scrim')
  })

  test('an untagged Flex game still reads as Flex', async () => {
    const page = await games('')
    expect(page.games.find((game) => game.matchId === flexId)?.kind).toBe('flex')
  })
})

describe('another team’s tag is another team’s business', () => {
  test('a game they tagged as a tournament is still Flex for us', async () => {
    const page = await games('')
    expect(page.games.find((game) => game.matchId === taggedByBOnlyId)?.kind).toBe('flex')
  })

  test('their note is not our note', async () => {
    const page = await games('')
    expect(page.games.find((game) => game.matchId === taggedByBOnlyId)?.note).toBeNull()
    expect(page.games.find((game) => game.matchId === taggedByAId)?.note).toBe('our note')
  })
})

describe('the tagged scopes finally return something', () => {
  test('?scope=scrim returns our scrim and not the untagged games', async () => {
    const page = await games('?scope=scrim')
    expect(page.games.map((game) => game.matchId)).toEqual([taggedByAId])
  })

  test('?scope=tournament does not return a tag that is not ours', async () => {
    const page = await games('?scope=tournament')
    expect(page.games).toEqual([])
  })

  test('?scope=flex drops the game we re-tagged as a scrim', async () => {
    // the half-applied filter §8.1 warns about: the row moved tabs, the numbers must move with it
    const page = await games('?scope=flex')
    const ids = page.games.map((game) => game.matchId)
    expect(ids).toContain(flexId)
    expect(ids).not.toContain(taggedByAId)
  })

  test('?scope=other stays honestly empty — it is the absence of a known id, not a tag', async () => {
    expect((await games('?scope=other')).games).toEqual([])
  })
})
