import { desc, inArray } from 'drizzle-orm'
import type { Db } from '../db/index.ts'
import { type ChampionRow, championPatches, champions } from '../db/schema.ts'
import type { ChampionLabelDto, ChampionsDto } from '../db/schema.types.ts'
import type { HexserveClient } from './client.ts'
import type { RefreshDeps } from './refresh.ts'
import { refreshChampions } from './refresh.ts'
import { championCacheState } from './rules.ts'

/**
 * The read side of the champion cache (hexserve-champion-data.md §4, §6).
 *
 * `GET /api/champions` returns labels **already flattened to one row per id**, resolved here so no
 * client can resurrect per-patch labels by asking for a patch. The rule is the one thing this
 * module exists for: a champion is labelled from the newest retained patch, or from the previous
 * one if it is absent there, and never from the patch the game happened to be played on.
 */

/**
 * One label per id, newest patch first, ordered by `championId`.
 *
 * `patchOrder` is newest-first and comes from the database (ordered by the dump's timestamp), not
 * from the order rows happened to arrive in — the `16.9.1` / `16.10.1` trap must not re-enter
 * through a `SELECT` without an `ORDER BY`. Sorting the result by id keeps a response byte-stable
 * between reads; presenting it alphabetically is the SPA's choice, because names are locale-bound.
 */
export function flattenChampionLabels(
  rows: readonly ChampionRow[],
  patchOrder: readonly string[],
): ChampionLabelDto[] {
  const byPatch = new Map<string, Map<number, ChampionRow>>()
  for (const row of rows) {
    const bucket = byPatch.get(row.patch) ?? new Map<number, ChampionRow>()
    bucket.set(row.championId, row)
    byPatch.set(row.patch, bucket)
  }

  const byId = new Map<number, ChampionLabelDto>()
  for (const patch of patchOrder) {
    for (const row of byPatch.get(patch)?.values() ?? []) {
      if (byId.has(row.championId)) continue
      byId.set(row.championId, {
        championId: row.championId,
        name: row.name,
        slug: row.slug,
        iconUrl: row.iconUrl,
        positions: row.positions,
        roles: row.roles,
      })
    }
  }

  return [...byId.values()].sort((a, b) => a.championId - b.championId)
}

/**
 * What we hold, shaped for the endpoint. `dumpVersion` is what the caller's refresh attempt learnt
 * — `null` when the dump was unreachable — because the cache alone cannot know what it is missing.
 */
export async function readChampionCache(db: Db, dumpVersion: string | null): Promise<ChampionsDto> {
  const patches = await db
    .select()
    .from(championPatches)
    .orderBy(desc(championPatches.publishedAtTimestamp))

  const patchOrder = patches.map((row) => row.patch)
  const rows =
    patchOrder.length === 0
      ? []
      : await db.select().from(champions).where(inArray(champions.patch, patchOrder))

  const newest = patches[0]

  return {
    patch: newest?.patch ?? null,
    previousPatch: patches[1]?.patch ?? null,
    patchPublishedAt: newest?.publishedAt.getTime() ?? null,
    fetchedAt: newest?.fetchedAt.getTime() ?? null,
    state: championCacheState(patchOrder, dumpVersion),
    champions: flattenChampionLabels(rows, patchOrder),
  }
}

export type LoadChampionsDeps = Pick<RefreshDeps, 'db' | 'client' | 'locale' | 'logger' | 'now'>

/**
 * Refresh-if-needed, then read. One entry point so the endpoint cannot accidentally serve labels
 * that are a patch old because it forgot to look (§5).
 */
export async function loadChampions(deps: LoadChampionsDeps): Promise<ChampionsDto> {
  const { dumpVersion } = await refreshChampions(deps)
  return readChampionCache(deps.db, dumpVersion)
}

/** Re-exported so a caller needs one import for the cache's public surface. */
export type { ChampionLabelDto, ChampionsDto, HexserveClient }
