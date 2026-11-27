import type { MatchKind, TaggableKind, TournamentKind } from './match.ts'
import { isRemake, resolveKind } from './match-stats.ts'

/**
 * Champion stats — the numbers behind the sheet's right-hand table (match-history.md §8, §8.1).
 *
 * Input is *our* participant rows, already joined to a person; output is one row per
 * `(person, champion)`. No DB and no React, for the same reason `mergeIntervals` lives in shared:
 * these are the numbers that can be wrong **confidently** — a 0-game champion rendered as `0%`, a
 * 100%-from-one-game that reads like a 100%-from-ten, or a `lastPlayedAt` that came from a scope the
 * rest of the row is not filtered to.
 *
 * **No champion name.** The doc's sketch lists `championName`, but §5.4/§5.7 forbid storing one and
 * the label is a lookup in the Hexserve cache at render time. A pure function that invented a name
 * would be the second source of truth that rule exists to prevent.
 */

/**
 * What the toolbar selects (§9): `all`, or exactly one resolved kind.
 *
 * Not a second vocabulary on purpose — a scope *is* a kind or "everything", so a filter and its
 * label cannot drift apart (quick-wins B2). Adding `ranked5` to `MATCH_KINDS` therefore added it to
 * the scope selector for free, with no DB column involved.
 */
export type MatchScope = 'all' | MatchKind

/**
 * One of our participant rows, flattened for this function.
 *
 * `win` is `boolean | null` because the column is nullable (a manual row may omit KDA — it must not
 * omit the result, but the type cannot say that), and `durationSeconds` is nullable for manual rows.
 * Both are handled by one visible rule below rather than by a caller's discipline.
 */
export type MatchStatRow = {
  /** The **person** (`user.id`), not the account: a smurf merges into one row (§10.4). */
  playerId: string
  championId: number
  win: boolean | null
  gameStartAt: Date
  durationSeconds?: number | null
  queueId?: number | null
  gameType?: string | null
  tournamentKind?: TournamentKind | null
  taggedKind?: TaggableKind | null
}

export type ChampionStat = {
  playerId: string
  championId: number
  games: number
  wins: number
  losses: number
  /** Integer percent, or `null` when there is nothing to divide — so the cell can render `–`. */
  winrate: number | null
  lastPlayedAt: Date
}

/** The one place a row becomes a scope decision. Exported for the games list, which filters too. */
export function filterByScope(rows: readonly MatchStatRow[], scope: MatchScope): MatchStatRow[] {
  return rows.filter((row) => scope === 'all' || resolveKind(row) === scope)
}

/**
 * A row we cannot count is not counted at all — no partial row, no zero, no guess:
 *
 * - **a remake** is not a game you won or lost (§7). Excluding it from `games` while letting it move
 *   `lastPlayedAt` would make the date disagree with the count, so it is dropped whole; a champion
 *   that was only ever remade simply has no row.
 * - **a row with no decided result** cannot become a winrate. `0` would be a lie in the other
 *   direction, so it is dropped too.
 */
function isCountable(row: MatchStatRow): boolean {
  return typeof row.win === 'boolean' && !isRemake(row.durationSeconds)
}

/**
 * One row per `(person, champion)` **inside the scope** — `games`, `wins`, `losses`, `winrate` and
 * `lastPlayedAt` are all computed after the filter (§8.1). Applying the scope afterwards in a
 * component is exactly how "Flex W/L" ends up next to a SoloQ date.
 *
 * Order is deterministic (more games first, then champion id, then player id) so two renders of the
 * same data cannot disagree.
 */
export function championStats(
  rows: readonly MatchStatRow[],
  options: { scope: MatchScope },
): ChampionStat[] {
  const groups = new Map<string, ChampionStat>()

  for (const row of filterByScope(rows, options.scope)) {
    if (!isCountable(row)) continue

    // a NUL separator cannot occur in either id, so two different pairs can never collide
    const key = `${row.playerId}\u0000${row.championId}`
    const existing = groups.get(key)
    const won = row.win === true

    if (!existing) {
      groups.set(key, {
        playerId: row.playerId,
        championId: row.championId,
        games: 1,
        wins: won ? 1 : 0,
        losses: won ? 0 : 1,
        winrate: null, // filled in below, once every row of the group is known
        lastPlayedAt: row.gameStartAt,
      })
      continue
    }

    existing.games += 1
    if (won) existing.wins += 1
    else existing.losses += 1
    if (row.gameStartAt > existing.lastPlayedAt) existing.lastPlayedAt = row.gameStartAt
  }

  return [...groups.values()]
    .map((entry) => ({
      ...entry,
      // `Math.round`, never `Math.floor`: the sheet's 1/6 is 17%, and 56% must not become 55%
      winrate: entry.games === 0 ? null : Math.round((entry.wins / entry.games) * 100),
    }))
    .sort(
      (a, b) =>
        b.games - a.games || a.championId - b.championId || a.playerId.localeCompare(b.playerId),
    )
}

export type WinrateTone = 'good' | 'meh' | 'bad' | 'none'

/**
 * The WR cell's colour, in one function with the thresholds written down once (§8) — the way
 * `badges.tsx` maps statuses.
 *
 * The sheet's own examples fix the boundaries: 100 and 56 are green, 50 amber, 40 and 17 red. So
 * green from 55, amber from 45, red below — and **no games is `none`, not red**: `–` and `0%` are
 * different statements and the table must not blur them.
 */
export function winrateTone(winrate: number | null, games: number): WinrateTone {
  if (games === 0 || winrate === null) return 'none'
  if (winrate >= 55) return 'good'
  if (winrate >= 45) return 'meh'
  return 'bad'
}
