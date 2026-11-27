import {
  assignLanes,
  isRemake,
  laneKey,
  MATCH_KINDS,
  type MatchScope,
  resolveKind,
  roleFromTeamPosition,
  scopeQueueFilter,
  type TaggableKind,
} from '@lol/shared'
import { and, desc, eq, inArray, isNull, lt, or, type SQL } from 'drizzle-orm'
import type { Db } from '../db/index.ts'
import {
  matchAnnotations,
  matches,
  matchParticipants,
  memberships,
  profile,
  riotAccounts,
  user,
} from '../db/schema.ts'
import type { MatchGameDto, MatchGamesPage, MatchLaneRefDto } from '../db/schema.types.ts'

/**
 * The games list, read (match-history.md §5.2, §6, §7, §9).
 *
 * **The tenancy rule, stated here because it is invisible in the SQL below:** `match` and
 * `match_participant` carry no `teamId` (§5.2), so this read never starts from `match`. It starts
 * from *the team's people* and their accounts, and only then joins the games they were in. A query
 * that began with `FROM match` would expose every team's games the moment a second team exists — and
 * would keep passing every test that only has one team.
 *
 * "Ours" therefore has two halves, and a row is ours if either holds:
 *
 * - `puuid` ∈ the team members' accounts → a Riot row (§5.2);
 * - `userId` ∈ the team's members → a hand-entered row, which names a person, not an account (§5.8).
 */
export type ReadGamesInput = {
  teamId: string
  scope: MatchScope
  /** Opaque to the client: produced by `encodeCursor`, never parsed by it. */
  cursor: string | null
  limit: number
}

/**
 * A cursor over `(gameStartAt, id)`, not `OFFSET` (§9): an 18-month history is thousands of rows, and
 * a game inserted mid-page would shift every offset by one.
 *
 * `id` is **ours**, because a manual row has no Riot id to sort by, and the pair makes the order
 * total — two matches can start in the same second.
 */
export function encodeCursor(match: { gameStartAt: Date; id: string }): string {
  return `${match.gameStartAt.toISOString()}|${match.id}`
}

/** `null` for anything that is not a cursor we produced — a bad cursor is "start over", not a 500. */
export function decodeCursor(
  raw: string | null | undefined,
): { gameStartAt: Date; id: string } | null {
  if (!raw) return null
  // the **first** separator: the ISO instant never contains one, while our own id could one day
  // contain anything. `lastIndexOf` would turn such an id into a malformed date and reset the page.
  const separator = raw.indexOf('|')
  if (separator <= 0) return null

  const gameStartAt = new Date(raw.slice(0, separator))
  const id = raw.slice(separator + 1)
  if (Number.isNaN(gameStartAt.getTime()) || id.length === 0) return null

  return { gameStartAt, id }
}

/** A page is capped so one client cannot ask for a season in one request. */
export const GAMES_PAGE_DEFAULT = 50
export const GAMES_PAGE_MAX = 100

export type GamesQuery = { scope: MatchScope; cursor: string | null; limit: number }

/**
 * The query string, parsed and judged in one pure place (unit-tested, no HTTP).
 *
 * Every value is optional and every default is the safe one: no scope is `all` (what a fresh page
 * shows), no limit is the default page, and an over-large limit is **clamped**, not refused — a
 * client asking for 5000 wants "as much as you have", which is exactly what `max` means here.
 *
 * An unknown scope *is* refused: silently falling back to `all` would render every kind under the
 * label the user picked, which is the wrong-data-with-a-confident-label failure this feature keeps
 * having to avoid.
 */
export function parseGamesQuery(query: {
  scope?: string
  cursor?: string
  limit?: string
}): { ok: true; value: GamesQuery } | { ok: false; message: string } {
  const scopes: readonly string[] = ['all', ...MATCH_KINDS]
  const scope = query.scope?.trim() || 'all'
  if (!scopes.includes(scope)) {
    return { ok: false, message: `unknown scope: ${scope}` }
  }

  const rawLimit = query.limit?.trim()
  const limit = rawLimit === undefined || rawLimit === '' ? GAMES_PAGE_DEFAULT : Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 1) {
    return { ok: false, message: 'limit must be a positive whole number' }
  }

  return {
    ok: true,
    value: {
      scope: scope as MatchScope,
      cursor: query.cursor?.trim() || null,
      limit: Math.min(limit, GAMES_PAGE_MAX),
    },
  }
}

/**
 * The team's people and their accounts — the **only** legitimate starting point for any match read
 * (§5.2). Extracted so the games list and the champion stats cannot drift apart: a second copy of
 * "who is ours" is a second chance to leak another team's games.
 */
export type TeamAccounts = {
  memberIds: string[]
  puuids: string[]
  accounts: { puuid: string; userId: string; gameName: string; tagLine: string }[]
}

export async function loadTeamAccounts(db: Db, teamId: string): Promise<TeamAccounts> {
  const memberRows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.teamId, teamId))
  const memberIds = memberRows.map((row) => row.userId)
  if (memberIds.length === 0) return { memberIds, puuids: [], accounts: [] }

  const accounts = await db
    .select({
      puuid: riotAccounts.puuid,
      userId: riotAccounts.userId,
      gameName: riotAccounts.gameName,
      tagLine: riotAccounts.tagLine,
    })
    .from(riotAccounts)
    .where(inArray(riotAccounts.userId, memberIds))

  return { memberIds, puuids: accounts.map((account) => account.puuid), accounts }
}

/** Both halves of "ours": an account of a member, or a member named by a hand-entered row. */
export function ourRowsCondition(
  memberIds: readonly string[],
  puuids: readonly string[],
): SQL | undefined {
  const conditions = [inArray(matchParticipants.userId, [...memberIds])]
  if (puuids.length > 0) conditions.push(inArray(matchParticipants.puuid, [...puuids]))
  return conditions.reduce<SQL | undefined>(
    (combined, condition) => (combined ? or(combined, condition) : condition),
    undefined,
  )
}

/** Resolved once per request, not once per row. */
type Looking = {
  /** puuid → whose account it is, and its label. */
  accountByPuuid: Map<string, { userId: string; label: string }>
  displayNameByUserId: Map<string, string>
}

export async function readGames(db: Db, input: ReadGamesInput): Promise<MatchGamesPage> {
  const empty: MatchGamesPage = { games: [], nextCursor: null, scope: input.scope }

  const filter = scopeQueueFilter(input.scope)
  // `tournament` and `scrim` are a per-team tag, and become a join below (§6). `other` is the
  // *absence* of a known id — no filter can express it, so it stays honestly empty instead of
  // pretending to be "everything we do not classify".
  if (filter.kind === 'tagged' && input.scope !== 'scrim' && input.scope !== 'tournament') {
    return empty
  }

  const { memberIds, puuids, accounts } = await loadTeamAccounts(db, input.teamId)
  if (memberIds.length === 0) return empty

  // one shared definition of "ours", used by the games list and the champion stats alike (§5.2)
  const visible = ourRowsCondition(memberIds, puuids)

  const cursor = decodeCursor(input.cursor)
  const cursorCondition = cursor
    ? or(
        lt(matches.gameStartAt, cursor.gameStartAt),
        and(eq(matches.gameStartAt, cursor.gameStartAt), lt(matches.id, cursor.id)),
      )
    : undefined

  // Page over **matches**, not participant rows: one game is up to five rows, and slicing rows
  // would cut a match in half at every page boundary.
  const page = await db
    .selectDistinct({
      id: matches.id,
      gameStartAt: matches.gameStartAt,
      durationSeconds: matches.durationSeconds,
      queueId: matches.queueId,
      gameType: matches.gameType,
      source: matches.source,
      // this **team's** tag, joined rather than fetched separately: it decides the kind and it
      // filters the tagged scopes, and a second query could disagree with the page
      taggedKind: matchAnnotations.taggedKind,
      note: matchAnnotations.note,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matchParticipants.matchId, matches.id))
    .leftJoin(
      matchAnnotations,
      and(eq(matchAnnotations.matchId, matches.id), eq(matchAnnotations.teamId, input.teamId)),
    )
    .where(and(visible, scopeCondition(filter, input.scope), cursorCondition))
    .orderBy(desc(matches.gameStartAt), desc(matches.id))
    .limit(input.limit + 1)

  const hasMore = page.length > input.limit
  const pageMatches = page.slice(0, input.limit)
  const last = pageMatches.at(-1)
  if (!last) return empty

  const matchIds = pageMatches.map((match) => match.id)

  // the team's annotation is already joined into `page` above, so it is not fetched again here —
  // two sources for the same tag is exactly how a row's kind and its note end up disagreeing
  const [participants, profiles, users] = await Promise.all([
    // *all ten* participants of those matches: the lane columns need the other nine (§5.1)
    db.select().from(matchParticipants).where(inArray(matchParticipants.matchId, matchIds)),
    db
      .select({ userId: profile.userId, displayName: profile.displayName })
      .from(profile)
      .where(inArray(profile.userId, memberIds)),
    db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, memberIds)),
  ])

  const looking: Looking = {
    accountByPuuid: new Map(
      accounts.map((account) => [
        account.puuid,
        { userId: account.userId, label: `${account.gameName}#${account.tagLine}` },
      ]),
    ),
    displayNameByUserId: new Map([
      ...users.map((row) => [row.id, row.name] as const),
      // the profile name wins over the Discord name, exactly like the roster page
      ...profiles.map((row) => [row.userId, row.displayName] as const),
    ]),
  }

  const memberSet = new Set(memberIds)
  const puuidSet = new Set(puuids)
  const isOurs = (row: { puuid: string | null; userId: string | null }): boolean =>
    (row.puuid !== null && puuidSet.has(row.puuid)) ||
    (row.userId !== null && memberSet.has(row.userId))

  const participantsByMatch = groupBy(participants, (row) => row.matchId)

  const games: MatchGameDto[] = []
  for (const match of pageMatches) {
    const rows = participantsByMatch.get(match.id) ?? []
    const lanes = assignLanes(rows)
    // the fixed precedence (§6): the tournament membership is still to come (§4.7), then this
    // team's tag, then Riot's queue id
    const kind = resolveKind({
      queueId: match.queueId,
      gameType: match.gameType,
      taggedKind: match.taggedKind,
    })

    /**
     * A lane reference, by **`laneKey(side, slot)`** — the key `assignLanes` answers with (§7).
     *
     * Not by puuid: an enemy somebody typed into a scrim has no puuid, so a puuid-keyed lookup would
     * answer `null` for exactly the opponents a human took the trouble to name.
     */
    const refOf = (key: string | null): MatchLaneRefDto | null => {
      if (!key) return null
      const row = rows.find((candidate) => laneKey(candidate.side, candidate.slot) === key)
      if (!row) return null

      const account = row.puuid ? looking.accountByPuuid.get(row.puuid) : undefined
      const userId = row.userId ?? account?.userId ?? null
      return {
        puuid: row.puuid,
        userId,
        displayName: userId ? (looking.displayNameByUserId.get(userId) ?? null) : null,
        championId: row.championId,
      }
    }

    for (const row of rows) {
      if (!isOurs(row)) continue

      const account = row.puuid ? looking.accountByPuuid.get(row.puuid) : undefined
      const personId = account?.userId ?? row.userId ?? null
      const assignment = lanes.get(laneKey(row.side, row.slot))

      games.push({
        matchId: match.id,
        gameStartAt: match.gameStartAt.toISOString(),
        kind,
        provenance: match.source,
        isRemake: isRemake(match.durationSeconds),
        queueId: match.queueId,
        durationSeconds: match.durationSeconds,
        // "how many of ours were on *this* side" — 3/5, not 5/10 (§7)
        teamCount: rows.filter((candidate) => candidate.side === row.side && isOurs(candidate))
          .length,
        player: {
          userId: personId,
          displayName: personId ? (looking.displayNameByUserId.get(personId) ?? null) : null,
          account: account?.label ?? null,
        },
        championId: row.championId,
        // one mapping for the whole app (§5.4): Riot's string is never handed to a renderer
        role: roleFromTeamPosition(row.teamPosition),
        win: row.win,
        kills: row.kills,
        deaths: row.deaths,
        assists: row.assists,
        cs: row.cs,
        goldEarned: row.goldEarned,
        visionScore: row.visionScore,
        lane: {
          partner: refOf(assignment?.partner ?? null),
          laneOpponent: refOf(assignment?.laneOpponent ?? null),
          opponentPartner: refOf(assignment?.opponentPartner ?? null),
        },
        note: match.note,
      })
    }
  }

  return { games, nextCursor: hasMore ? encodeCursor(last) : null, scope: input.scope }
}

/**
 * The scope's SQL half, from the same tables the classifier reads (§5, §8.1).
 *
 * Three shapes, matching `scopeQueueFilter`'s three answers: a queue-id list, this team's tag, or
 * nothing at all. Writing any of them twice — here and in the pure function — is what `scopeQueueFilter`
 * exists to prevent.
 */
function scopeCondition(
  filter: ReturnType<typeof scopeQueueFilter>,
  scope: MatchScope,
): SQL | undefined {
  if (filter.kind === 'all') return undefined

  if (filter.kind === 'tagged') {
    // only reached for `scrim` / `tournament`; `other` returned before the query. The cast is the
    // narrow one: both are members of the column's own union, which `MatchScope` is not.
    return eq(matchAnnotations.taggedKind, scope as TaggableKind)
  }

  const inIds = inArray(matches.queueId, [...filter.queueIds])
  // custom games are usually queue id 0, but Riot has also sent a real id with CUSTOM_GAME —
  // `classifyQueue` honours both, so the SQL must as well or the two would disagree
  const byQueue = scope === 'custom' ? or(inIds, eq(matches.gameType, 'CUSTOM_GAME')) : inIds

  // **a tag outranks the queue id** (§6), so a queue scope only holds games this team has not
  // re-tagged. Without this, a scrim-tagged Flex game keeps appearing under Flex while its row says
  // "Scrim" — the half-applied filter §8.1 warns about. A `custom` tag lands in the custom scope.
  const untagged = and(isNull(matchAnnotations.taggedKind), byQueue)
  if (scope === 'custom') {
    return or(untagged, eq(matchAnnotations.taggedKind, 'custom'))
  }
  return untagged
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const row of rows) grouped.set(key(row), [...(grouped.get(key(row)) ?? []), row])
  return grouped
}
