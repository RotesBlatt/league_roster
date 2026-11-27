/**
 * The match vocabulary (match-history.md §5, §6) — names only, no rules.
 *
 * Kept here rather than in the API because the `CHECK` constraints in `apps/api/src/db/schema.ts`
 * are generated from these arrays (quick-wins.md D1). Typing the values out a second time in the
 * schema is the duplication trap B2 already bit us with: it is right on the day it is written and
 * drifts silently afterwards.
 *
 * `classifyQueue` / `resolveKind` / `championStats` (the rules) are a later patch — this file is
 * deliberately just vocabulary, so the schema can land before any of the logic exists.
 */

/**
 * Who wrote the row. Exactly two, and that is the design (§5.9): a tournament game is a `riot` row
 * plus a membership link, and a hand-entered scrim is `manual`. Everything that counts, groups or
 * syncs branches on this one column, so a third writer would mean a third code path everywhere.
 */
export const MATCH_SOURCES = ['riot', 'manual'] as const
export type MatchSource = (typeof MATCH_SOURCES)[number]

/**
 * Riot's `side` numbers, used verbatim: 100 = blue, 200 = red. Not `0`/`1` and not `'blue'`,
 * because every comparison against a payload would then need a translation step.
 */
export const MATCH_SIDES = [100, 200] as const
export type MatchSide = (typeof MATCH_SIDES)[number]

/**
 * What a **human** is allowed to say a game was (§6, §5.8). Deliberately narrow:
 *
 * - `solo`/`flex`/`normal` are Riot facts (`queueId`) — a re-tag that contradicted them would be a
 *   lie about data we hold, so they are not decisions anybody makes;
 * - `other` is the fallback for a queue id we have not seen, never a label to choose;
 * - `custom` survives as a tag because a hand-entered row has no `queueId` to classify.
 *
 * Lives in `match_annotation.taggedKind`, which the sync's write path cannot reach (§5.5).
 */
export const TAGGABLE_KINDS = ['tournament', 'scrim', 'custom'] as const
export type TaggableKind = (typeof TAGGABLE_KINDS)[number]

/**
 * What a `tournament` row is *for* — one human decision per tournament or code block (§4.7, §6).
 *
 * Deliberately not the same set as `MATCH_KINDS`: this label lives on the **code**, not on the game.
 * `practice` exists here and nowhere else, because a game played on a practice block is a `scrim` —
 * the narrower word would tell a reader nothing useful about the game itself. `resolveKind` is the
 * one place that translation happens.
 */
export const TOURNAMENT_KINDS = ['tournament', 'scrim', 'practice'] as const
export type TournamentKind = (typeof TOURNAMENT_KINDS)[number]

/**
 * The resolved kind of one game, from the single precedence
 * `tournament.kind → annotation.taggedKind → classifyQueue → 'other'` (§6). One set for the whole
 * app: the games list, the champion-stats scope and the SQL filter all read from it, so a filter and
 * its label cannot disagree.
 *
 * `ranked5` is the premade-five ladder (queue id 710): ranked, like `solo` and `flex`, but its own
 * ladder and therefore its own data set — folding it into `flex` would put two ratings' games into
 * one winrate. **No column stores a resolved kind** (§5 bucket table: it is a derivation), so this
 * list is free to grow without a migration; only `TAGGABLE_KINDS` and `MATCH_SOURCES` reach the DB.
 */
export const MATCH_KINDS = [
  'solo',
  'flex',
  'ranked5',
  'normal',
  'custom',
  'tournament',
  'scrim',
  'other',
] as const
export type MatchKind = (typeof MATCH_KINDS)[number]

/**
 * What the games list and the champion table are filtered to: `all`, or exactly one kind.
 *
 * Deliberately **not** a second vocabulary — a scope *is* a kind or "everything", so a filter and
 * its label cannot drift apart (quick-wins B2) and adding a kind adds a selector for free. It lives
 * here rather than beside the stats because the SQL filter and the pure functions both need it, and
 * neither may own it.
 */
export type MatchScope = 'all' | MatchKind
