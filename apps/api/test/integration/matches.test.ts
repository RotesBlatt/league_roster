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
 * `GET /api/teams/:slug/matches` (match-history.md §5.2, §6, §8.1, §9).
 *
 * The read is where the feature's one **tenancy exemption** can go wrong, so that is what this file
 * pins: `match` has no `teamId`, and a query that started from the fact tables would show every
 * team's games. With one team in the database that mistake passes; with two it does not.
 */
let ctx: TestContext
let server: TestServer
let call: TestServer['call']

let teamAId: string
let teamBId: string
let slugA: string
let slugB: string
let captainA: string
let memberA: string
let outsiderA: string
let captainCookie: string
let outsiderCookie: string

/** Insert an account and hand back its puuid. */
async function addAccount(userId: string, label: string): Promise<string> {
  const puuid = `puuid-${label}`
  await ctx.db.execute(sql`
    insert into riot_account ("id", "userId", "gameName", "tagLine", "puuid", "createdAt")
    values (${crypto.randomUUID()}, ${userId}, ${label}, 'EUW', ${puuid}, now())
  `)
  return puuid
}

/** A capability-free person who still needs a profile row to render a name like a member does. */
async function addProfile(userId: string, displayName: string): Promise<void> {
  await ctx.db.execute(sql`
    insert into profile ("id", "userId", "displayName", "preferredRole", "updatedAt")
    values (${crypto.randomUUID()}, ${userId}, ${displayName}, 'MID', now())
  `)
}

type SeedParticipant = {
  side: number
  slot: number
  puuid?: string | null
  userId?: string | null
  teamPosition?: string | null
  championId?: number | null
  win?: boolean | null
  kills?: number | null
}

/** A Riot match plus its participants; `minutesAgo` drives the ordering. */
async function seedRiotMatch(input: {
  riotMatchId: string
  queueId: number | null
  gameType?: string
  minutesAgo: number
  durationSeconds?: number
  participants: SeedParticipant[]
}): Promise<string> {
  const id = crypto.randomUUID()
  await ctx.db.execute(sql`
    insert into "match"
      ("id", "source", "riotMatchId", "platformId", "gameStartAt", "durationSeconds",
       "queueId", "gameType", "fetchedAt")
    values (${id}, 'riot', ${input.riotMatchId}, 'euw1',
            now() - (${input.minutesAgo} * interval '1 minute'),
            ${input.durationSeconds ?? 1800}, ${input.queueId},
            ${input.gameType ?? 'MATCHED_GAME'}, now())
  `)
  for (const participant of input.participants) {
    await ctx.db.execute(sql`
      insert into match_participant
        ("id", "matchId", "side", "slot", "puuid", "userId", "teamPosition",
         "championId", "win", "kills")
      values (${crypto.randomUUID()}, ${id}, ${participant.side}, ${participant.slot},
              ${participant.puuid ?? null}, ${participant.userId ?? null},
              ${participant.teamPosition ?? null}, ${participant.championId ?? null},
              ${participant.win ?? null}, ${participant.kills ?? null})
    `)
  }
  return id
}

async function seedManualMatch(input: {
  minutesAgo: number
  userId: string
  championId: number
}): Promise<string> {
  const id = crypto.randomUUID()
  await ctx.db.execute(sql`
    insert into "match" ("id", "source", "gameStartAt", "createdByTeamId", "createdBy")
    values (${id}, 'manual', now() - (${input.minutesAgo} * interval '1 minute'),
            ${teamAId}, ${input.userId})
  `)
  await ctx.db.execute(sql`
    insert into match_participant
      ("id", "matchId", "side", "slot", "userId", "championId", "win")
    values (${crypto.randomUUID()}, ${id}, 100, 1, ${input.userId}, ${input.championId}, true)
  `)
  return id
}

const games = async (query: string, cookie = captainCookie): Promise<MatchGamesPage> => {
  const response = await call(`/api/teams/${slugA}/matches${query}`, { cookie })
  expect(response.status).toBe(200)
  return (await response.json()) as MatchGamesPage
}

let flexMatchId: string
let soloMatchId: string
let remakeMatchId: string
let manualMatchId: string
let teamBOnlyMatchId: string

beforeAll(async () => {
  ctx = await createTestContext()
  server = createTestApp(ctx)
  call = server.call

  captainA = await createUser(ctx, { name: 'Captain A' })
  memberA = await createUser(ctx, { name: 'Member A' })
  outsiderA = await createUser(ctx, { name: 'Outsider' })
  slugA = `a-${crypto.randomUUID().slice(0, 8)}`
  teamAId = await seedTeam(ctx, { createdBy: captainA, slug: slugA, name: 'Team A' })
  await addMembership(ctx, { teamId: teamAId, userId: captainA, role: 'captain' })
  await addMembership(ctx, { teamId: teamAId, userId: memberA })
  await addProfile(memberA, 'Member A Profile')

  const teamBCaptain = await createUser(ctx, { name: 'Captain B' })
  slugB = `b-${crypto.randomUUID().slice(0, 8)}`
  teamBId = await seedTeam(ctx, { createdBy: teamBCaptain, slug: slugB, name: 'Team B' })
  await addMembership(ctx, { teamId: teamBId, userId: teamBCaptain, role: 'captain' })

  const puuidA1 = await addAccount(captainA, 'captain-a')
  const puuidA2 = await addAccount(memberA, 'member-a')
  const puuidB = await addAccount(teamBCaptain, 'captain-b')

  captainCookie = await createSessionCookie(ctx, captainA)
  outsiderCookie = await createSessionCookie(ctx, outsiderA)

  flexMatchId = await seedRiotMatch({
    riotMatchId: 'EUW1_900',
    queueId: 440,
    minutesAgo: 30,
    participants: [
      {
        side: 100,
        slot: 1,
        puuid: puuidA1,
        teamPosition: 'TOP',
        championId: 103,
        win: true,
        kills: 7,
      },
      { side: 100, slot: 2, puuid: puuidA2, teamPosition: 'JUNGLE', championId: 64, win: true },
      // the enemy top laner — the lane opponent the sheet wants a name for
      { side: 200, slot: 6, puuid: 'puuid-enemy-top', teamPosition: 'TOP', championId: 24 },
      { side: 200, slot: 7, puuid: 'puuid-enemy-jgl', teamPosition: 'JUNGLE', championId: 121 },
    ],
  })

  soloMatchId = await seedRiotMatch({
    riotMatchId: 'EUW1_901',
    queueId: 420,
    minutesAgo: 20,
    participants: [
      { side: 100, slot: 1, puuid: puuidA1, teamPosition: 'MIDDLE', championId: 1, win: false },
      { side: 200, slot: 6, puuid: 'puuid-enemy-mid', teamPosition: 'MIDDLE', championId: 2 },
    ],
  })

  // an ARAM-style short game: the remake marker comes from the duration, never a column
  remakeMatchId = await seedRiotMatch({
    riotMatchId: 'EUW1_902',
    queueId: 440,
    minutesAgo: 10,
    durationSeconds: 200,
    participants: [
      { side: 100, slot: 1, puuid: puuidA2, teamPosition: 'UTILITY', championId: 89, win: false },
    ],
  })

  manualMatchId = await seedManualMatch({ minutesAgo: 15, userId: memberA, championId: 89 })

  // another team's game: never visible to A, however many of their accounts were in it
  teamBOnlyMatchId = await seedRiotMatch({
    riotMatchId: 'EUW1_903',
    queueId: 440,
    minutesAgo: 5,
    participants: [
      { side: 100, slot: 1, puuid: puuidB, teamPosition: 'TOP', championId: 17, win: true },
    ],
  })
})

afterAll(async () => {
  server.close()
  await ctx.drop()
})

describe('the guard', () => {
  test('signed out is 401', async () => {
    const response = await call(`/api/teams/${slugA}/matches`)
    expect(response.status).toBe(401)
  })

  test('not a member of that team is 404 — the same answer as a team that does not exist', async () => {
    const response = await call(`/api/teams/${slugA}/matches`, { cookie: outsiderCookie })
    expect(response.status).toBe(404)
  })

  test("another team's slug is not a way in", async () => {
    const response = await call(`/api/teams/${slugB}/matches`, { cookie: captainCookie })
    expect(response.status).toBe(404)
  })
})

describe('tenancy: a game belongs to Riot, but only your games are listed', () => {
  test("our players' games are visible, another team's game is not", async () => {
    const page = await games('')
    const matchIds = new Set(page.games.map((game) => game.matchId))

    expect(matchIds.has(flexMatchId)).toBe(true)
    expect(matchIds.has(soloMatchId)).toBe(true)
    expect(matchIds.has(teamBOnlyMatchId)).toBe(false)
  })

  test('nothing outside our accounts leaks in, even from the same match', async () => {
    // the Flex game has four participants; only the two of ours are rows
    const page = await games('')
    const flexRows = page.games.filter((game) => game.matchId === flexMatchId)
    expect(flexRows).toHaveLength(2)
    expect(flexRows.map((row) => row.player.displayName).sort()).toEqual([
      'Captain A',
      'Member A Profile',
    ])
  })
})

describe('one row per participant', () => {
  test('teamCount counts our side, not the whole lobby', async () => {
    const page = await games('')
    const flexRows = page.games.filter((game) => game.matchId === flexMatchId)
    // two of ours on side 100 out of a 2v2 seed — 5/10 would mean nothing to a reader (§7)
    expect(flexRows.every((row) => row.teamCount === 2)).toBe(true)
  })

  test('Riot’s position is mapped to our role vocabulary, never passed through', async () => {
    const page = await games('')
    const top = page.games.find(
      (game) => game.matchId === flexMatchId && game.player.displayName === 'Captain A',
    )
    const jungle = page.games.find(
      (game) => game.matchId === flexMatchId && game.player.displayName === 'Member A Profile',
    )
    expect(top?.role).toBe('TOP')
    expect(jungle?.role).toBe('JGL')
  })

  test('the lane opponent is there, by champion — that is what we can render for an enemy', async () => {
    const page = await games('')
    const top = page.games.find(
      (game) => game.matchId === flexMatchId && game.player.displayName === 'Captain A',
    )
    expect(top?.lane.laneOpponent?.championId).toBe(24)
    // an enemy has a puuid but no account of ours, so no name is invented for them
    expect(top?.lane.laneOpponent?.displayName).toBeNull()
    expect(top?.lane.laneOpponent?.puuid).toBe('puuid-enemy-top')
  })

  test('a solo laner has no partner', async () => {
    const page = await games('')
    const top = page.games.find(
      (game) => game.matchId === flexMatchId && game.player.displayName === 'Captain A',
    )
    expect(top?.lane.partner).toBeNull()
  })
})

describe('the scope is applied in SQL, not after the page', () => {
  test('Flex keeps the Flex games and drops the SoloQ one', async () => {
    const page = await games('?scope=flex')
    const matchIds = new Set(page.games.map((game) => game.matchId))
    expect(matchIds.has(flexMatchId)).toBe(true)
    expect(matchIds.has(soloMatchId)).toBe(false)
  })

  test('SoloQ keeps only the SoloQ game', async () => {
    const page = await games('?scope=solo')
    expect(page.games.map((game) => game.matchId)).toEqual([soloMatchId])
  })

  test('the echoed scope is what was asked for', async () => {
    expect((await games('?scope=solo')).scope).toBe('solo')
  })

  test('an unknown scope is refused instead of being shown as something else', async () => {
    const response = await call(`/api/teams/${slugA}/matches?scope=aram`, {
      cookie: captainCookie,
    })
    expect(response.status).toBe(400)
  })

  test('a scope nothing can produce yet is honestly empty, not an error', async () => {
    // no route writes `match_annotation` yet, so "scrim" has to mean "nothing", not "everything"
    const page = await games('?scope=scrim')
    expect(page.games).toEqual([])
  })
})

describe('a hand-entered game sits in the same list', () => {
  test('it appears with provenance "manual" and no invented stats', async () => {
    const page = await games('')
    const manual = page.games.find((game) => game.matchId === manualMatchId)
    expect(manual).toBeDefined()
    expect(manual?.provenance).toBe('manual')
    expect(manual?.kills).toBeNull()
    expect(manual?.durationSeconds).toBeNull()
    expect(manual?.player.displayName).toBe('Member A Profile')
  })

  test('it is not in a queue scope, because it has no queue to classify', async () => {
    const page = await games('?scope=flex')
    expect(page.games.some((game) => game.matchId === manualMatchId)).toBe(false)
  })
})

describe('a remake is marked, not hidden', () => {
  test('a 200-second game is flagged and still listed', async () => {
    const page = await games('')
    const remake = page.games.find((game) => game.matchId === remakeMatchId)
    expect(remake).toBeDefined()
    expect(remake?.isRemake).toBe(true)
  })

  test('a 30-minute game is not', async () => {
    const page = await games('')
    const normal = page.games.find((game) => game.matchId === soloMatchId)
    expect(normal?.isRemake).toBe(false)
  })
})

describe('the cursor pages over games, newest first', () => {
  test('the first page is the newest game and carries a cursor', async () => {
    const all = await games('')
    const page = await games('?limit=1')

    expect(page.games).toHaveLength(1)
    // compared against the full list rather than a hardcoded id: the fixture's own ages decide
    // the order, and a test that restates them is a test that breaks when a fixture moves
    expect(page.games[0]?.matchId).toBe(all.games[0]?.matchId)
    expect(page.nextCursor).not.toBeNull()
  })

  test('the next page continues without repeating or skipping', async () => {
    const first = await games('?limit=1')
    const second = await games(`?limit=1&cursor=${encodeURIComponent(first.nextCursor ?? '')}`)

    expect(second.games[0]?.matchId).not.toBe(first.games[0]?.matchId)
    // the manual game is 15 min old and the Flex 30, so it comes between them
    expect(second.games[0]?.matchId).toBe(manualMatchId)
  })

  test('a whole list read in pages of one equals the single-page read', async () => {
    const all = await games('')
    const seen: string[] = []
    let cursor: string | null = null
    for (let page = 0; page < 20; page += 1) {
      const query: string = `?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
      const next: MatchGamesPage = await games(query)
      seen.push(...next.games.map((game) => game.matchId))
      cursor = next.nextCursor
      if (!cursor) break
    }
    expect(seen).toEqual(all.games.map((game) => game.matchId))
  })

  test('a junk cursor starts over instead of failing', async () => {
    const page = await games('?cursor=not-a-cursor')
    expect(page.games.length).toBeGreaterThan(0)
  })
})
