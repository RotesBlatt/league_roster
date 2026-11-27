import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import type { TeamStatsDto } from '../../src/db/schema.types.ts'
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
 * `GET /api/teams/:slug/stats` (match-history.md §8, §8.1, §9).
 *
 * The numbers here are the ones a reader trusts without checking, so what is pinned is every way
 * they could be quietly wrong: another team's games counted, one person counted twice for two
 * accounts, a remake counted as a loss, or a player with no games showing 0% instead of `–`.
 */
let ctx: TestContext
let server: TestServer
let call: TestServer['call']

let teamAId: string
let slugA: string
let captainA: string
let memberA: string
let noGames: string
let cookieA: string
let puuidMain: string
let puuidSmurf: string

async function addAccount(userId: string, label: string): Promise<string> {
  const puuid = `puuid-${label}`
  await ctx.db.execute(sql`
    insert into riot_account ("id", "userId", "gameName", "tagLine", "puuid", "createdAt")
    values (${crypto.randomUUID()}, ${userId}, ${label}, 'EUW', ${puuid}, now())
  `)
  return puuid
}

type SeedParticipant = {
  puuid?: string | null
  userId?: string | null
  championId?: number | null
  win?: boolean | null
  side?: number
  slot?: number
}

/** A Riot game; participants default to side 100 and their position in the list. */
async function seedGame(input: {
  riotMatchId: string
  minutesAgo: number
  durationSeconds?: number
  queueId?: number | null
  participants: SeedParticipant[]
}): Promise<string> {
  const id = crypto.randomUUID()
  await ctx.db.execute(sql`
    insert into "match" ("id", "source", "riotMatchId", "platformId", "gameStartAt",
                         "durationSeconds", "queueId", "gameType", "fetchedAt")
    values (${id}, 'riot', ${input.riotMatchId}, 'euw1',
            now() - (${input.minutesAgo} * interval '1 minute'),
            ${input.durationSeconds ?? 1800}, ${input.queueId ?? 440}, 'MATCHED_GAME', now())
  `)
  for (const [index, participant] of input.participants.entries()) {
    await ctx.db.execute(sql`
      insert into match_participant ("id", "matchId", "side", "slot", "puuid", "userId", "championId", "win")
      values (${crypto.randomUUID()}, ${id}, ${participant.side ?? 100}, ${participant.slot ?? index + 1},
              ${participant.puuid ?? null}, ${participant.userId ?? null},
              ${participant.championId ?? 1}, ${participant.win ?? true})
    `)
  }
  return id
}

async function addProfile(userId: string, displayName: string, role: string): Promise<void> {
  await ctx.db.execute(sql`
    insert into profile ("id", "userId", "displayName", "preferredRole", "updatedAt")
    values (${crypto.randomUUID()}, ${userId}, ${displayName}, ${role}, now())
  `)
}

async function addRoster(userId: string, roleOverride: string | null): Promise<void> {
  await ctx.db.execute(sql`
    insert into roster_entry ("id", "teamId", "userId", "roleOverride", "isActive", "createdAt", "updatedAt")
    values (${crypto.randomUUID()}, ${teamAId}, ${userId}, ${roleOverride}, true, now(), now())
  `)
}

const stats = async (slug = slugA, cookie = cookieA): Promise<TeamStatsDto> => {
  const response = await call(`/api/teams/${slug}/stats`, { cookie })
  expect(response.status).toBe(200)
  return (await response.json()) as TeamStatsDto
}

const playerOf = (page: TeamStatsDto, userId: string) =>
  page.players.find((player) => player.userId === userId)

beforeAll(async () => {
  ctx = await createTestContext()
  server = createTestApp(ctx)
  call = server.call

  captainA = await createUser(ctx, { name: 'Captain A' })
  memberA = await createUser(ctx, { name: 'Member A' })
  noGames = await createUser(ctx, { name: 'No Games' })

  slugA = `a-${crypto.randomUUID().slice(0, 8)}`
  teamAId = await seedTeam(ctx, { createdBy: captainA, slug: slugA, name: 'Team A' })
  await addMembership(ctx, { teamId: teamAId, userId: captainA, role: 'captain' })
  await addMembership(ctx, { teamId: teamAId, userId: memberA })
  await addMembership(ctx, { teamId: teamAId, userId: noGames })

  await addProfile(captainA, 'Captain A', 'JGL')
  await addProfile(memberA, 'Member A', 'TOP')
  await addRoster(captainA, null)
  await addRoster(memberA, null)
  await addRoster(noGames, null)

  puuidMain = await addAccount(memberA, 'member-main')
  puuidSmurf = await addAccount(memberA, 'member-smurf')
  cookieA = await createSessionCookie(ctx, captainA)

  // two accounts of one person on the same champion: one row, two games
  await seedGame({
    riotMatchId: 'EUW1_S1',
    minutesAgo: 30,
    participants: [
      { puuid: puuidMain, championId: 103, win: true },
      { puuid: 'enemy-1', championId: 24, side: 200, win: false },
    ],
  })
  await seedGame({
    riotMatchId: 'EUW1_S2',
    minutesAgo: 20,
    participants: [
      { puuid: puuidSmurf, championId: 103, win: false },
      { puuid: 'enemy-2', championId: 24, side: 200, win: true },
    ],
  })
  // a second champion, and a remake that must not count
  await seedGame({
    riotMatchId: 'EUW1_S3',
    minutesAgo: 10,
    participants: [{ puuid: puuidMain, championId: 1, win: true }],
  })
  await seedGame({
    riotMatchId: 'EUW1_S4',
    minutesAgo: 5,
    durationSeconds: 200,
    participants: [{ puuid: puuidMain, championId: 1, win: false }],
  })

  // a hand-entered game: attributed by person, no puuid (§5.8)
  await ctx.db.execute(sql`
    insert into "match" ("id", "source", "gameStartAt", "createdByTeamId")
    values ('manual-1', 'manual', now() - interval '40 minutes', ${teamAId})
  `)
  await ctx.db.execute(sql`
    insert into match_participant ("id", "matchId", "side", "slot", "userId", "championId", "win")
    values (${crypto.randomUUID()}, 'manual-1', 100, 1, ${captainA}, 89, false)
  `)

  // another team's game, which must not appear in any number
  const captainB = await createUser(ctx, { name: 'Captain B' })
  const slugB = `b-${crypto.randomUUID().slice(0, 8)}`
  const teamBId = await seedTeam(ctx, { createdBy: captainB, slug: slugB, name: 'Team B' })
  await addMembership(ctx, { teamId: teamBId, userId: captainB, role: 'captain' })
  const puuidB = await addAccount(captainB, 'captain-b')
  await seedGame({
    riotMatchId: 'EUW1_B1',
    minutesAgo: 15,
    participants: [{ puuid: puuidB, championId: 17, win: true }],
  })
})

afterAll(async () => {
  server.close()
  await ctx.drop()
})

describe('the guard', () => {
  test('signed out is 401', async () => {
    expect((await call(`/api/teams/${slugA}/stats`)).status).toBe(401)
  })
})

describe('one row per person and champion (§10.4, §8)', () => {
  test('two accounts on the same champion are one row with two games', async () => {
    const member = playerOf(await stats(), memberA)
    const galio = member?.champions.find((champion) => champion.championId === 103)

    expect(galio).toMatchObject({ games: 2, wins: 1, losses: 1, winrate: 50 })
  })

  test('a second champion is its own row, and the player total sums them', async () => {
    const member = playerOf(await stats(), memberA)

    expect(member?.champions.map((champion) => champion.championId).sort()).toEqual([1, 103])
    expect(member?.champions.find((champion) => champion.championId === 1)).toMatchObject({
      games: 1,
      wins: 1,
      winrate: 100,
    })
    expect(member).toMatchObject({ games: 3, wins: 2, losses: 1, winrate: 67 })
  })

  test('a remake never counts (§7)', async () => {
    // the 200-second Annie game is stored but excluded: 103 + 103 + 1, not four
    expect(playerOf(await stats(), memberA)?.games).toBe(3)
  })

  test('last played is the newest counted game', async () => {
    const member = playerOf(await stats(), memberA)
    const annie = member?.champions.find((champion) => champion.championId === 1)
    const galio = member?.champions.find((champion) => champion.championId === 103)

    expect(new Date(String(annie?.lastPlayedAt)).getTime()).toBeGreaterThan(
      new Date(String(galio?.lastPlayedAt)).getTime(),
    )
  })
})

describe('a hand-entered game counts, attributed to the person (§5.8)', () => {
  test('the captain’s scrim shows up in their own stats', async () => {
    const captain = playerOf(await stats(), captainA)
    expect(captain?.champions.find((champion) => champion.championId === 89)).toMatchObject({
      games: 1,
      wins: 0,
      winrate: 0,
    })
  })
})

describe('a player with no games is a column, not a gap (§9)', () => {
  test('zero games reads as `–`, never as 0%', async () => {
    const player = playerOf(await stats(), noGames)
    expect(player).toMatchObject({ games: 0, wins: 0, losses: 0, winrate: null })
    expect(player?.lastPlayedAt).toBeNull()
    expect(player?.champions).toEqual([])
  })
})

describe('tenancy (§5.2)', () => {
  test("another team's game is in nobody's numbers here", async () => {
    const page = await stats()
    const champions = page.players.flatMap((player) =>
      player.champions.map((champion) => champion.championId),
    )
    // champion 17 is the other team's captain; none of ours played it
    expect(champions).not.toContain(17)
  })
})

describe('the columns follow the roster', () => {
  test('roster order puts the TOP before the JGL', async () => {
    const ids = (await stats()).players.map((player) => player.userId)
    expect(ids.indexOf(memberA)).toBeLessThan(ids.indexOf(captainA))
  })
})
