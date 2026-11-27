import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { createTestContext, createUser, seedTeam, type TestContext } from './helpers.ts'

/**
 * The match schema, as the database itself enforces it (match-history.md §5, §5.1, §5.8, §6).
 *
 * The invariants under test are the ones every later patch depends on and none of them can be
 * trusted to a route:
 *
 * - **one row per game** — `UNIQUE (riotMatchId)` is what makes the hourly loop idempotent, and it
 *   is the guarantee `ON CONFLICT DO NOTHING` leans on (§4.4);
 * - **one row per (match, puuid)** — five accounts in one Flex game is one match and five
 *   participants, and the *second* account's insert must lose quietly, not duplicate;
 * - **a partial unique**, because an unknown opponent is a participant row with no puuid at all
 *   (§5.1) — NULLs must not collapse into each other;
 * - **a manual row** carries a date, our five and a win, and nothing else (§5.8);
 * - **the two vocabularies are guarded by CHECKs**, so a raw insert cannot invent a source or
 *   re-tag a game as SoloQ (§6).
 *
 * Raw SQL on purpose: a drizzle insert would refuse a bad enum at *compile* time, which proves the
 * types work, not that the constraint does.
 */
let ctx: TestContext
let teamId: string
let userId: string

beforeAll(async () => {
  ctx = await createTestContext()
  userId = await createUser(ctx, { name: 'Schema Owner' })
  teamId = await seedTeam(ctx, { createdBy: userId })
})

afterAll(async () => {
  await ctx.drop()
})

/** Postgres' code, wherever the driver put it — drizzle keeps the pg error on `cause`. */
function pgCode(error: unknown): string | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string') return code
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}

async function expectCode(run: PromiseLike<unknown>, code: string): Promise<void> {
  let actual: string | undefined
  try {
    await run
  } catch (error) {
    actual = pgCode(error)
  }
  expect(actual).toBe(code)
}

/** 23505 = unique violation, 23514 = check violation, 23503 = foreign key violation. */
const UNIQUE = '23505'
const CHECK = '23514'
const FOREIGN_KEY = '23503'

/** A Riot row with only the columns Riot always gives us. */
async function insertRiotMatch(riotMatchId: string): Promise<string> {
  const id = crypto.randomUUID()
  await ctx.db.execute(sql`
    insert into "match"
      ("id", "source", "riotMatchId", "platformId", "gameStartAt", "queueId", "gameType", "fetchedAt")
    values (${id}, 'riot', ${riotMatchId}, 'euw1', now(), 440, 'MATCHED_GAME', now())
  `)
  return id
}

/**
 * Riot's participant shape: slot 1-10, a side, and a champion. `puuid` is optional so the same
 * helper can write the unknown-opponent row a manual match has; `userId` is optional because only a
 * hand-entered row knows *which member* played without claiming which account (§5.8).
 */
async function insertParticipant(input: {
  matchId: string
  side: number
  slot: number
  puuid?: string | null
  userId?: string | null
  championId?: number | null
  win?: boolean | null
}): Promise<void> {
  await ctx.db.execute(sql`
    insert into match_participant
      ("id", "matchId", "side", "slot", "puuid", "userId", "championId", "win")
    values (
      ${crypto.randomUUID()}, ${input.matchId}, ${input.side}, ${input.slot},
      ${input.puuid ?? null}, ${input.userId ?? null}, ${input.championId ?? null},
      ${input.win ?? null}
    )
  `)
}

/** A hand-entered scrim: a date, a team and a person — and no Riot fact at all (§5.8). */
async function insertManualMatch(): Promise<string> {
  const id = crypto.randomUUID()
  await ctx.db.execute(sql`
    insert into "match" ("id", "source", "gameStartAt", "createdByTeamId", "createdBy")
    values (${id}, 'manual', now(), ${teamId}, ${userId})
  `)
  return id
}

describe('one game is one row', () => {
  test('the five of ours in one Flex game is one match and five participants', async () => {
    const matchId = await insertRiotMatch('EUW1_1000000001')
    for (let slot = 1; slot <= 5; slot += 1) {
      await insertParticipant({
        matchId,
        side: 100,
        slot,
        puuid: `puuid-${slot}`,
        championId: slot,
      })
    }

    const participants = [
      ...(await ctx.db.execute<{ players: number }>(sql`
        select count(*)::int as players from match_participant where "matchId" = ${matchId}
      `)),
    ]
    expect(participants[0]?.players).toBe(5)
  })

  test('a second insert of the same Riot match is refused — that is what makes the loop idempotent', async () => {
    const matchId = await insertRiotMatch('EUW1_1000000002')
    expect(matchId).toBeTruthy()

    await expectCode(
      ctx.db.execute(sql`
        insert into "match" ("id", "source", "riotMatchId", "gameStartAt")
        values (${crypto.randomUUID()}, 'riot', 'EUW1_1000000002', now())
      `),
      UNIQUE,
    )
  })

  test('the same puuid twice in one match is refused', async () => {
    const matchId = await insertRiotMatch('EUW1_1000000003')
    await insertParticipant({ matchId, side: 100, slot: 1, puuid: 'same-puuid' })

    await expectCode(
      ctx.db.execute(sql`
        insert into match_participant ("id", "matchId", "side", "slot", "puuid")
        values (${crypto.randomUUID()}, ${matchId}, 200, 6, 'same-puuid')
      `),
      UNIQUE,
    )
  })

  test('two unknown opponents (no puuid) may both sit in one match', async () => {
    // §5.1: an unknown opponent is a row with a slot and nothing else, not a fake puuid — so the
    // unique index has to be partial, or the second one would collide on NULL
    const matchId = await insertRiotMatch('EUW1_1000000004')
    await insertParticipant({ matchId, side: 200, slot: 6, puuid: null, championId: 60 })
    await insertParticipant({ matchId, side: 200, slot: 7, puuid: null, championId: 89 })
  })

  test('a side holds a slot once: (match, side, slot) is unique', async () => {
    const matchId = await insertRiotMatch('EUW1_1000000005')
    await insertParticipant({ matchId, side: 100, slot: 1 })

    await expectCode(
      ctx.db.execute(sql`
        insert into match_participant ("id", "matchId", "side", "slot")
        values (${crypto.randomUUID()}, ${matchId}, 100, 1)
      `),
      UNIQUE,
    )
    // the same slot number on the *other* side is a different participant, not a duplicate
    await insertParticipant({ matchId, side: 200, slot: 1 })
  })
})

describe('a Riot row and a manual row are the same table', () => {
  test('a hand-entered scrim needs a date, our five and a win — and no Riot fact at all', async () => {
    const matchId = crypto.randomUUID()
    await ctx.db.execute(sql`
      insert into "match" ("id", "source", "gameStartAt", "createdByTeamId", "createdBy")
      values (${matchId}, 'manual', now(), ${teamId}, ${userId})
    `)
    // champion + win is all a hand-entered row can honestly carry (§5.8); the KDA columns stay NULL
    await insertParticipant({ matchId, side: 100, slot: 1, championId: 103, win: true })
    await insertParticipant({ matchId, side: 200, slot: 6, puuid: null, championId: 1 })
  })

  test('a Riot row without a riotMatchId is refused — the source is not a label, it is a promise', async () => {
    await expectCode(
      ctx.db.execute(sql`
        insert into "match" ("id", "source", "gameStartAt")
        values (${crypto.randomUUID()}, 'riot', now())
      `),
      CHECK,
    )
  })

  test('match.source rejects a third writer', async () => {
    await expectCode(
      ctx.db.execute(sql`
        insert into "match" ("id", "source", "gameStartAt")
        values (${crypto.randomUUID()}, 'website', now())
      `),
      CHECK,
    )
  })
})

describe('the vocabularies are constrained in the database', () => {
  test('a participant side is 100 or 200, never 0 or 1', async () => {
    const matchId = await insertRiotMatch('EUW1_1000000006')
    await expectCode(
      ctx.db.execute(sql`
        insert into match_participant ("id", "matchId", "side", "slot")
        values (${crypto.randomUUID()}, ${matchId}, 0, 1)
      `),
      CHECK,
    )
  })

  test('a human may tag a match as scrim, but not as solo — that is a Riot fact', async () => {
    const matchId = await insertRiotMatch('EUW1_1000000007')

    await expectCode(
      ctx.db.execute(sql`
        insert into match_annotation ("matchId", "teamId", "taggedKind", "updatedAt")
        values (${matchId}, ${teamId}, 'solo', now())
      `),
      CHECK,
    )

    await ctx.db.execute(sql`
      insert into match_annotation ("matchId", "teamId", "taggedKind", "updatedAt")
      values (${matchId}, ${teamId}, 'scrim', now())
    `)
  })
})

describe('the human fields sit in their own table', () => {
  test('two notes for one match and one team are one row, not two', async () => {
    const matchId = await insertRiotMatch('EUW1_1000000008')
    await ctx.db.execute(sql`
      insert into match_annotation ("matchId", "teamId", "note", "updatedAt")
      values (${matchId}, ${teamId}, 'first note', now())
    `)

    await expectCode(
      ctx.db.execute(sql`
        insert into match_annotation ("matchId", "teamId", "note", "updatedAt")
        values (${matchId}, ${teamId}, 'second note', now())
      `),
      UNIQUE,
    )
  })

  test('deleting a match takes its participants and its notes with it', async () => {
    const matchId = await insertRiotMatch('EUW1_1000000009')
    await insertParticipant({ matchId, side: 100, slot: 1, puuid: 'orphan-check' })
    await ctx.db.execute(sql`
      insert into match_annotation ("matchId", "teamId", "note", "updatedAt")
      values (${matchId}, ${teamId}, 'goes away too', now())
    `)

    await ctx.db.execute(sql`delete from "match" where "id" = ${matchId}`)

    const [participants, annotations] = await Promise.all([
      ctx.db.execute<{ rows: number }>(sql`
        select count(*)::int as rows from match_participant where "matchId" = ${matchId}
      `),
      ctx.db.execute<{ rows: number }>(sql`
        select count(*)::int as rows from match_annotation where "matchId" = ${matchId}
      `),
    ])
    expect([...participants][0]?.rows).toBe(0)
    expect([...annotations][0]?.rows).toBe(0)
  })
})

describe('process state', () => {
  test('one sync cursor per account, and it goes when the account goes', async () => {
    const accountId = crypto.randomUUID()
    await ctx.db.execute(sql`
      insert into riot_account ("id", "userId", "gameName", "tagLine", "puuid", "createdAt")
      values (${accountId}, ${userId}, 'Cursor#EUW', 'EUW', ${crypto.randomUUID()}, now())
    `)
    await ctx.db.execute(sql`
      insert into account_sync ("riotAccountId", "lastAttemptAt")
      values (${accountId}, now())
    `)

    await expectCode(
      ctx.db.execute(sql`
        insert into account_sync ("riotAccountId", "lastAttemptAt")
        values (${accountId}, now())
      `),
      UNIQUE,
    )

    await ctx.db.execute(sql`delete from riot_account where "id" = ${accountId}`)
    const [remaining] = [
      ...(await ctx.db.execute<{ rows: number }>(sql`
        select count(*)::int as rows from account_sync where "riotAccountId" = ${accountId}
      `)),
    ]
    expect(remaining?.rows).toBe(0)
  })

  test('a skipped match id is recorded once, with its attempts counting from zero', async () => {
    await ctx.db.execute(sql`
      insert into match_skip ("matchId", "reason", "lastAttemptAt")
      values ('EUW1_404', 'not found', now())
    `)
    const [row] = [
      ...(await ctx.db.execute<{ attempts: number }>(sql`
        select "attempts" from match_skip where "matchId" = 'EUW1_404'
      `)),
    ]
    expect(row?.attempts).toBe(0)

    await expectCode(
      ctx.db.execute(sql`
        insert into match_skip ("matchId", "reason", "lastAttemptAt")
        values ('EUW1_404', 'not found', now())
      `),
      UNIQUE,
    )
  })
})

/**
 * A hand-entered game names a **person**, not an account (§5.8).
 *
 * Riot rows are attributed by the join `match_participant.puuid ⋈ riot_account` (§5.2) — and that
 * join is exactly what a scrim cannot use: nobody knows, hours later, which of their accounts was in
 * the game, and demanding it would make the form unfillable. So `userId` is the manual row's honest
 * answer, and it is NULL on every Riot row.
 */
describe('a hand-entered game names a person', () => {
  test('a manual participant carries the member, and no puuid', async () => {
    const matchId = await insertManualMatch()
    const memberId = await createUser(ctx, { name: 'Scrim Player' })
    await insertParticipant({
      matchId,
      side: 100,
      slot: 1,
      userId: memberId,
      championId: 103,
      win: true,
    })

    const [row] = [
      ...(await ctx.db.execute<{ userId: string | null; puuid: string | null }>(sql`
        select "userId", "puuid" from match_participant
        where "matchId" = ${matchId} and "slot" = 1
      `)),
    ]
    expect(row?.userId).toBe(memberId)
    expect(row?.puuid).toBeNull()
  })

  test('a Riot participant has no userId — the puuid join is what says who played', async () => {
    const matchId = await insertRiotMatch('EUW1_1000000010')
    await insertParticipant({ matchId, side: 100, slot: 1, puuid: 'riot-puuid' })

    const [row] = [
      ...(await ctx.db.execute<{ userId: string | null }>(sql`
        select "userId" from match_participant where "matchId" = ${matchId}
      `)),
    ]
    expect(row?.userId).toBeNull()
  })

  test('one person on two of their own accounts in one game stays two rows (§5.2)', async () => {
    // legal, and the reason there is deliberately **no** unique on (matchId, userId): the same
    // person can be in a game twice on two smurfs, and a custom game can split the roster
    const matchId = await insertRiotMatch('EUW1_1000000011')
    const memberId = await createUser(ctx)
    await insertParticipant({ matchId, side: 100, slot: 1, puuid: 'smurf-a', userId: memberId })
    await insertParticipant({ matchId, side: 200, slot: 6, puuid: 'smurf-b', userId: memberId })
  })

  test('deleting the account does not delete the game — history is not rewritten (§5.6)', async () => {
    const matchId = await insertManualMatch()
    const leaving = await createUser(ctx)
    await insertParticipant({
      matchId,
      side: 100,
      slot: 1,
      userId: leaving,
      championId: 1,
      win: true,
    })

    await ctx.db.execute(sql`delete from "user" where "id" = ${leaving}`)

    const [row] = [
      ...(await ctx.db.execute<{ userId: string | null }>(sql`
        select "userId" from match_participant where "matchId" = ${matchId}
      `)),
    ]
    expect(row).toBeDefined()
    expect(row?.userId).toBeNull()
  })

  test('an unknown user id is refused by the database, not trusted to a route', async () => {
    const matchId = await insertManualMatch()
    await expectCode(
      ctx.db.execute(sql`
        insert into match_participant ("id", "matchId", "side", "slot", "userId")
        values (${crypto.randomUUID()}, ${matchId}, 100, 2, ${crypto.randomUUID()})
      `),
      FOREIGN_KEY,
    )
  })
})
