import type { MatchKind, MatchScope, TaggableKind, TournamentKind } from './match.ts'

/**
 * "What kind of game was this?" — the rules behind `MATCH_KINDS` (match-history.md §6, §7).
 *
 * One resolution order for the whole app, in one function, because the failure mode here is silent:
 * a Flex game that lands in the SoloQ scope produces no error, just a wrong percentage. Everything
 * below is a pure function over plain values — no DB, no React, no dates.
 *
 * The two labels Riot cannot give us are the reason this file exists at all: `tournament` and
 * `scrim` come from a membership row and a human decision respectively, never from a queue id.
 */

/**
 * Riot's queue ids, mapped to our scopes. Only the queues we scope are listed: everything else is
 * `other` **on purpose**, because a scope that quietly swallowed ARAM would inflate a champion's
 * games with matches that have no lane and no comparison to a ranked game.
 *
 * Add a queue here the day its games should count in a scope — not before. The union of the table
 * is the product decision; the table is where it is written down.
 */
const QUEUE_KINDS: Readonly<Record<number, MatchKind>> = {
  // Custom games. In the table rather than a special case in `classifyQueue`, so the reverse map
  // below knows it too: a queue reachable only by a branch would have no id for the SQL filter.
  0: 'custom',
  400: 'normal', // Normal Draft Pick
  420: 'solo', // Ranked Solo/Duo
  430: 'normal', // Normal Blind Pick
  440: 'flex', // Ranked Flex
  /**
   * Ranked 5v5 — premade fives only, its own ladder and therefore its own data set.
   *
   * **Evidence status:** the id comes from the product owner, not from Riot's published list. The
   * official `queues.json` has no 710 at all (it has 700 = SR Clash and 720 = ARAM Clash), so 710
   * sits in the Clash range and this mapping is unconfirmed. Confirm it against one recorded match
   * payload before treating it as proof: if 710 is Clash after all, the consequence is a scope that
   * reports a tournament-ish mode as ranked — which is why it is written down rather than hidden.
   */
  710: 'ranked5',
}

/** Below this, the game never really happened (match-history.md §7). */
export const REMAKE_MAX_SECONDS = 300

/**
 * The Riot half of the classification. **Never returns `tournament` or `scrim`** — those labels do
 * not exist in Riot's payload, and a function that pretended otherwise is how a league game ends up
 * in the wrong bucket (§6).
 *
 * A missing `queueId` is `other`, not an error: a hand-entered row has none, and an unknown id is
 * the queue Riot ships next month.
 */
export function classifyQueue(
  queueId: number | null | undefined,
  gameType?: string | null,
): MatchKind {
  // Riot is inconsistent about which of the two fields carries "this was a custom game", so both
  // are honoured; queue id 0 is in the table above (it is how almost every custom row looks)
  if (gameType === 'CUSTOM_GAME') return 'custom'
  if (queueId === null || queueId === undefined) return 'other'
  return QUEUE_KINDS[queueId] ?? 'other'
}

/** Everything the classification may see; all of it optional, because a manual row has none of it. */
export type KindInput = {
  /** From the tournament-code membership (§4.7) — a fact from Riot, once a human labelled the code. */
  tournamentKind?: TournamentKind | null
  /** From `match_annotation.taggedKind` — a human override, per team (§5.5). */
  taggedKind?: TaggableKind | null
  queueId?: number | null
  gameType?: string | null
}

/**
 * The single precedence (**§6**): `tournament.kind → annotation.taggedKind → classifyQueue →
 * 'other'`.
 *
 * The order is not arbitrary:
 *
 * - the **membership fact sits on top**, so a stray re-tag cannot demote a league game;
 * - `practice` translates to `scrim` here, which is why the schedule's narrower word never has to
 *   leak into the games list or the stats scope;
 * - a human tag beats the queue id, because a custom game somebody re-tagged *is* the answer, while
 *   a tag cannot contradict a tournament code.
 */
export function resolveKind(input: KindInput): MatchKind {
  const { tournamentKind, taggedKind, queueId, gameType } = input
  if (tournamentKind) return tournamentKind === 'tournament' ? 'tournament' : 'scrim'
  if (taggedKind) return taggedKind
  return classifyQueue(queueId, gameType)
}

/**
 * A remake is **derived, never stored** (§7, §5 bucket table): keep the match like any other,
 * exclude it from champion stats, show it in the games list with a marker. Hiding it entirely turns
 * "why is my last game not here?" into a support question.
 *
 * `null` duration is not a remake — that is the only honest answer for a hand-entered row, and
 * guessing the other way would silently drop a real scrim from the stats.
 */
export function isRemake(durationSeconds: number | null | undefined): boolean {
  return (
    durationSeconds !== null &&
    durationSeconds !== undefined &&
    durationSeconds < REMAKE_MAX_SECONDS
  )
}

/**
 * How a scope becomes a SQL predicate (§5, §8.1).
 *
 * Three answers, because there are three genuinely different situations:
 *
 * - `all` — no filter at all. Deliberately not "every id we know": an `IN` list is exactly how the
 *   queue Riot ships next month becomes invisible;
 * - `queues` — the ids that can produce this scope, derived from `QUEUE_KINDS` so the SQL and
 *   `classifyQueue` cannot disagree;
 * - `tagged` — a scope that **no queue id can produce**: `tournament` and `scrim` are a membership
 *   row and a human tag, and `other` is the *absence* of a known id. Filtering these by queueId
 *   would return the wrong games confidently, so the caller has to use the tag/membership join
 *   instead. Until that join exists, such a scope is honestly empty.
 */
export type ScopeQueueFilter =
  | { kind: 'all' }
  | { kind: 'queues'; queueIds: readonly number[] }
  | { kind: 'tagged' }

/** Derives the reverse map once: kind → the queue ids that classify into it, ascending. */
const QUEUE_IDS_BY_KIND: ReadonlyMap<MatchKind, readonly number[]> = (() => {
  const byKind = new Map<MatchKind, number[]>()
  for (const [queueId, kind] of Object.entries(QUEUE_KINDS)) {
    byKind.set(kind, [...(byKind.get(kind) ?? []), Number(queueId)])
  }
  for (const ids of byKind.values()) ids.sort((a, b) => a - b)
  return byKind
})()

export function scopeQueueFilter(scope: MatchScope): ScopeQueueFilter {
  if (scope === 'all') return { kind: 'all' }
  const queueIds = QUEUE_IDS_BY_KIND.get(scope) ?? []
  if (queueIds.length === 0) return { kind: 'tagged' }
  return { kind: 'queues', queueIds }
}
