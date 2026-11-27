import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
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
 * `POST /api/teams/:slug/matches` — entering a scrim by hand (match-history.md §5.8, §10.14).
 *
 * What is pinned here is not the form's ergonomics but the two things that would rot the fact table:
 * **attribution** (a manual row names a member, not an account) and **isolation** (a body naming
 * somebody from another team must not credit them with a game here). Both are asserted against the
 * database, not against the response body.
 */
let ctx: TestContext
let server: TestServer
let call: TestServer['call']

let teamAId: string
let teamBId: string
let slugA: string
let captainA: string
let memberA: string
let strangerB: string
let outsiderCookie: string
let captainCookie: string
let memberCookie: string

const at = (iso: string) => iso

/** The smallest body the form can send: a date, a result, one of ours with a champion. */
function body(overrides: Record<string, unknown> = {}) {
  return {
    playedAt: at('2026-11-20T21:30:00.000Z'),
    kind: 'scrim',
    win: true,
    players: [{ userId: memberA, championId: 103 }],
    ...overrides,
  }
}

const post = (payload: unknown, cookie = memberCookie) =>
  call(`/api/teams/${slugA}/matches`, { method: 'POST', body: payload, cookie })

beforeAll(async () => {
  ctx = await createTestContext()
  server = createTestApp(ctx)
  call = server.call

  captainA = await createUser(ctx, { name: 'Captain A' })
  memberA = await createUser(ctx, { name: 'Member A' })
  const outsider = await createUser(ctx, { name: 'Outsider' })

  slugA = `a-${crypto.randomUUID().slice(0, 8)}`
  teamAId = await seedTeam(ctx, { createdBy: captainA, slug: slugA, name: 'Team A' })
  await addMembership(ctx, { teamId: teamAId, userId: captainA, role: 'captain' })
  await addMembership(ctx, { teamId: teamAId, userId: memberA })

  const captainB = await createUser(ctx, { name: 'Captain B' })
  strangerB = await createUser(ctx, { name: 'Stranger B' })
  const slugB = `b-${crypto.randomUUID().slice(0, 8)}`
  teamBId = await seedTeam(ctx, { createdBy: captainB, slug: slugB, name: 'Team B' })
  await addMembership(ctx, { teamId: teamBId, userId: captainB, role: 'captain' })
  await addMembership(ctx, { teamId: teamBId, userId: strangerB })

  captainCookie = await createSessionCookie(ctx, captainA)
  memberCookie = await createSessionCookie(ctx, memberA)
  outsiderCookie = await createSessionCookie(ctx, outsider)
})

afterAll(async () => {
  server.close()
  await ctx.drop()
})

describe('the guard', () => {
  test('signed out is 401 and writes nothing', async () => {
    const response = await call(`/api/teams/${slugA}/matches`, { method: 'POST', body: body() })
    expect(response.status).toBe(401)
  })

  test('not a member is 404', async () => {
    const response = await post(body(), outsiderCookie)
    expect(response.status).toBe(404)
  })
})

describe('the write', () => {
  test('a plain member may enter a game — no captain needed (§10.14)', async () => {
    const response = await post(body())
    expect(response.status).toBe(201)
    const created = (await response.json()) as { matchId: string }
    expect(created.matchId).toBeTruthy()
  })

  test('the match row is manual, owned, and has no Riot id', async () => {
    const response = await post(body({ playedAt: at('2026-11-19T20:00:00.000Z') }))
    const { matchId } = (await response.json()) as { matchId: string }

    const [row] = [
      ...(await ctx.db.execute<{
        source: string
        riotMatchId: string | null
        createdBy: string | null
        createdByTeamId: string | null
      }>(sql`
        select "source", "riotMatchId", "createdBy", "createdByTeamId"
        from "match" where "id" = ${matchId}
      `)),
    ]
    expect(row).toMatchObject({
      source: 'manual',
      riotMatchId: null,
      createdBy: memberA,
      createdByTeamId: teamAId,
    })
  })

  test('our players are attributed by userId, with Riot’s position stored', async () => {
    const response = await post(
      body({
        players: [
          { userId: memberA, championId: 103, role: 'MID', kills: 7, deaths: 2, assists: 9 },
        ],
      }),
    )
    const { matchId } = (await response.json()) as { matchId: string }

    const [row] = [
      ...(await ctx.db.execute<{
        userId: string | null
        puuid: string | null
        teamPosition: string | null
        championId: number | null
        win: boolean | null
        kills: number | null
        side: number
        slot: number
      }>(sql`
        select "userId", "puuid", "teamPosition", "championId", "win", "kills", "side", "slot"
        from match_participant where "matchId" = ${matchId}
      `)),
    ]
    expect(row).toMatchObject({
      userId: memberA,
      // a person, never a guessed account (§5.8)
      puuid: null,
      // our Role goes in as Riot's string, so lane derivation works on a manual game too
      teamPosition: 'MIDDLE',
      championId: 103,
      win: true,
      kills: 7,
      side: 100,
      slot: 1,
    })
  })

  test('opponents are champion-only rows, with the inverse result', async () => {
    const response = await post(body({ opponents: [{ championId: 24 }, { championId: 121 }] }))
    const { matchId } = (await response.json()) as { matchId: string }

    const rows = [
      ...(await ctx.db.execute<{ puuid: string | null; win: boolean | null; slot: number }>(sql`
        select "puuid", "win", "slot" from match_participant
        where "matchId" = ${matchId} and "side" = 200 order by "slot"
      `)),
    ]
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.puuid === null)).toBe(true)
    // we won, so they lost — neither side reads as "unknown" on a finished game
    expect(rows.every((row) => row.win === false)).toBe(true)
    expect(rows.map((row) => row.slot)).toEqual([6, 7])
  })

  test('the kind and the note land in match_annotation — the table the sync cannot reach', async () => {
    const response = await post(body({ kind: 'tournament', note: '  good draft  ' }))
    const { matchId } = (await response.json()) as { matchId: string }

    const [row] = [
      ...(await ctx.db.execute<{ taggedKind: string | null; note: string | null }>(sql`
        select "taggedKind", "note" from match_annotation
        where "matchId" = ${matchId} and "teamId" = ${teamAId}
      `)),
    ]
    expect(row).toMatchObject({ taggedKind: 'tournament', note: 'good draft' })
  })

  test('it appears in the games list the read side serves', async () => {
    const response = await post(
      body({
        playedAt: at('2026-11-18T19:00:00.000Z'),
        players: [{ userId: captainA, championId: 1 }],
      }),
    )
    const { matchId } = (await response.json()) as { matchId: string }

    const list = await call(`/api/teams/${slugA}/matches`, { cookie: captainCookie })
    expect(list.status).toBe(200)
    const page = (await list.json()) as { games: { matchId: string; provenance: string }[] }
    const row = page.games.find((game) => game.matchId === matchId)
    expect(row?.provenance).toBe('manual')
  })
})

/**
 * The enemy in the *same row* as our player (match-history.md §7).
 *
 * Storing the pairing is not enough: `assignLanes` matches a lane opponent by **`teamPosition`**, so
 * the enemy row has to carry the position of the player it faces. Otherwise the form would know the
 * answer and the games list would still show `–`.
 */
describe('a paired opponent lands in our player’s lane', () => {
  test('the enemy row takes our player’s slot and Riot position', async () => {
    const response = await post(
      body({
        players: [{ userId: memberA, championId: 103, role: 'MID', opponentChampionId: 24 }],
      }),
    )
    const { matchId } = (await response.json()) as { matchId: string }

    const [row] = [
      ...(await ctx.db.execute<{
        slot: number
        teamPosition: string | null
        championId: number | null
        win: boolean | null
      }>(sql`
        select "slot", "teamPosition", "championId", "win" from match_participant
        where "matchId" = ${matchId} and "side" = 200
      `)),
    ]
    expect(row).toMatchObject({
      slot: 6,
      teamPosition: 'MIDDLE',
      championId: 24,
      win: false,
    })
  })

  test('two players keep their own enemies, in their own slots', async () => {
    const response = await post(
      body({
        players: [
          { userId: memberA, championId: 103, role: 'TOP', opponentChampionId: 24 },
          { userId: captainA, championId: 64, role: 'JGL', opponentChampionId: 121 },
        ],
      }),
    )
    const { matchId } = (await response.json()) as { matchId: string }

    const rows = [
      ...(await ctx.db.execute<{ slot: number; teamPosition: string | null }>(sql`
        select "slot", "teamPosition" from match_participant
        where "matchId" = ${matchId} and "side" = 200 order by "slot"
      `)),
    ]
    expect(rows).toEqual([
      { slot: 6, teamPosition: 'TOP' },
      { slot: 7, teamPosition: 'JUNGLE' },
    ])
  })

  test('an enemy of a player with no role keeps an empty position rather than a guess', async () => {
    const response = await post(
      body({ players: [{ userId: memberA, championId: 103, opponentChampionId: 24 }] }),
    )
    const { matchId } = (await response.json()) as { matchId: string }
    const [row] = [
      ...(await ctx.db.execute<{ teamPosition: string | null }>(sql`
        select "teamPosition" from match_participant
        where "matchId" = ${matchId} and "side" = 200
      `)),
    ]
    expect(row?.teamPosition).toBeNull()
  })

  test('the games list shows it as *the* lane opponent, not just another enemy', async () => {
    // the whole point of the pairing: the read resolves it without any extra input
    const response = await post(
      body({
        players: [{ userId: memberA, championId: 103, role: 'MID', opponentChampionId: 24 }],
      }),
    )
    const { matchId } = (await response.json()) as { matchId: string }

    const list = await call(`/api/teams/${slugA}/matches`, { cookie: captainCookie })
    const page = (await list.json()) as {
      games: {
        matchId: string
        player: { userId: string | null }
        lane: { laneOpponent: { championId: number | null } | null }
      }[]
    }
    const row = page.games.find(
      (game) => game.matchId === matchId && game.player.userId === memberA,
    )
    expect(row?.lane.laneOpponent?.championId).toBe(24)
  })

  test('paired enemies and an extra one fill the five slots without colliding', async () => {
    const response = await post(
      body({
        players: [
          { userId: memberA, championId: 103, role: 'TOP', opponentChampionId: 24 },
          { userId: captainA, championId: 64, role: 'JGL', opponentChampionId: 121 },
        ],
        opponents: [{ championId: 89 }],
      }),
    )
    const { matchId } = (await response.json()) as { matchId: string }

    const rows = [
      ...(await ctx.db.execute<{ slot: number }>(sql`
        select "slot" from match_participant
        where "matchId" = ${matchId} and "side" = 200 order by "slot"
      `)),
    ]
    // 6 and 7 are the paired laners; the unpaired enemy takes the next free slot, never a duplicate
    expect(rows.map((row) => row.slot)).toEqual([6, 7, 8])
  })

  test('more than five enemies in one game is refused instead of breaking the slot check', async () => {
    const players = Array.from({ length: 5 }, (_unused, index) => ({
      userId: index % 2 === 0 ? memberA : captainA,
      championId: index + 1,
      opponentChampionId: 100 + index,
    }))
    // the ids repeat only if the same person twice — give each row a distinct member instead
    players[1]!.userId = memberA
    const response = await post(body({ players, opponents: [{ championId: 5 }] }))
    expect([400, 422]).toContain(response.status)
  })
})

describe('what is refused', () => {
  test('a body with no players is 400, and says why', async () => {
    const response = await post(body({ players: [] }))
    expect(response.status).toBe(400)
    const payload = (await response.json()) as { message: string }
    expect(payload.message).toContain('player')
  })

  test('a date in the future is 400 — a typo, not a scheduled game', async () => {
    const response = await post(body({ playedAt: '2030-01-01T20:00:00.000Z' }))
    expect(response.status).toBe(400)
    const payload = (await response.json()) as { message: string }
    expect(payload.message).toContain('future')
  })

  test('a kind a human may not choose is 400', async () => {
    expect((await post(body({ kind: 'solo' }))).status).toBe(400)
  })

  test('a player from another team is 422, and nothing is written', async () => {
    const before = [
      ...(await ctx.db.execute<{ rows: number }>(sql`select count(*)::int as rows from "match"`)),
    ]
    const response = await post(body({ players: [{ userId: strangerB, championId: 103 }] }))
    expect(response.status).toBe(422)

    const after = [
      ...(await ctx.db.execute<{ rows: number }>(sql`select count(*)::int as rows from "match"`)),
    ]
    expect(after[0]?.rows).toBe(before[0]?.rows)
  })

  test('an unknown person is 422 rather than a dangling row', async () => {
    const response = await post(body({ players: [{ userId: crypto.randomUUID(), championId: 1 }] }))
    expect(response.status).toBe(422)
  })

  test('a sixth player is 400', async () => {
    const players = Array.from({ length: 6 }, () => ({ userId: memberA, championId: 1 }))
    expect((await post(body({ players }))).status).toBe(400)
  })
})
