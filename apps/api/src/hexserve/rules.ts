import type { ChampionCacheState, PatchHistoryEntry } from '@lol/shared'

/**
 * The rules for the champion patch cache (hexserve-champion-data.md §4, §5) — pure functions, no
 * DB and no HTTP, so the refresh path and its edge cases are testable without either.
 *
 * **"Newest" is not "largest version string".** `16.9.1` sorts after `16.10.1` as text, so a string
 * comparison would prune the newer patch and keep the older one on the next refresh (§5, trap #2).
 */

/** Two patches = one release cycle, which is exactly the window where a missing label is noticed. */
export const RETAINED_PATCHES = 2

/**
 * The patch versions to keep, newest first, at most `RETAINED_PATCHES`.
 *
 * Ordered by `timestamp` (the dump's own clock), never by comparing version strings. A version
 * listed twice counts once, so a duplicated history entry cannot use up both slots.
 */
export function retainNewestTwo(history: readonly PatchHistoryEntry[]): string[] {
  const kept: string[] = []
  for (const entry of [...history].sort((a, b) => b.timestamp - a.timestamp)) {
    if (kept.includes(entry.version)) continue
    kept.push(entry.version)
    if (kept.length === RETAINED_PATCHES) break
  }
  return kept
}

/**
 * Whether a refresh has to run: only when the dump names a patch we do not hold.
 *
 * `dumpVersion === null` means the dump could not be read, and "keep what we have" is the answer —
 * an unreachable hobby host must never clear a working cache (§5, §7).
 */
export function needsRefresh(
  storedPatches: readonly string[],
  dumpVersion: string | null,
): boolean {
  if (dumpVersion === null) return false
  return !storedPatches.includes(dumpVersion)
}

/**
 * What the UI is allowed to say about the cache (§5):
 * - `current` — we hold the dump's current patch; labels come from it.
 * - `previous` — we hold rows, but not the newest patch (one behind, or the dump is unreachable).
 *   Labels still render from what we have; one patch of drift is invisible, an id-only page is not.
 * - `empty` — no rows at all (first boot, failed first fetch): ids and placeholders, pages work.
 */
export function championCacheState(
  storedPatches: readonly string[],
  dumpVersion: string | null,
): ChampionCacheState {
  if (storedPatches.length === 0) return 'empty'
  return dumpVersion !== null && storedPatches.includes(dumpVersion) ? 'current' : 'previous'
}
