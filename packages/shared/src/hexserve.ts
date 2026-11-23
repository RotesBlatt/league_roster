/**
 * The vocabulary of the champion/patch cache — types only, no rules.
 *
 * The refresh runs in the API and `GET /api/champions` resolves the state server-side
 * (hexserve-champion-data.md §6), so the rules live in `apps/api/src/hexserve/rules.ts`. What
 * crosses the wire is these two names, the same way `Role` and `Tier` name a stored value.
 */

/** One entry of the dump's `version.json` `history[]`: the patch and when it landed. */
export type PatchHistoryEntry = {
  version: string
  lastUpdate: string
  timestamp: number
}

/**
 * What the client may say about the cache the API is serving (§5):
 * - `current` — the dump's current patch; labels come from it.
 * - `previous` — rows exist but not the newest patch (one behind, or the dump is unreachable).
 * - `empty` — no rows at all: champion ids plus placeholders, pages still work.
 */
export type ChampionCacheState = 'current' | 'previous' | 'empty'
