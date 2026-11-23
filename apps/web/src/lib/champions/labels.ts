import type { ChampionLabelDto } from '@lol/api/schema-types'

/**
 * The SPA's champion lookup (hexserve-champion-data.md §4, §7).
 *
 * A pure function over the payload, not a component concern: "what do we show for this id" is the
 * decision that must never throw, and it is worth testing without a query or a render.
 *
 * The server already flattened one label per id, so this is a lookup and nothing more — there is
 * deliberately no per-patch resolution here, because that is how a champion starts changing name
 * halfway down a list.
 */

/**
 * The label for `championId`, or `null` when the dump does not know it.
 *
 * `undefined` is a normal input, not a bug: the query has no data yet on first render, and an
 * unknown id and a not-yet-loaded list must both render a placeholder rather than an error.
 * A linear scan over ~170 rows is cheaper than keeping a map in sync with the query cache.
 */
export function championLabelFor(
  champions: readonly ChampionLabelDto[] | undefined,
  championId: number,
): ChampionLabelDto | null {
  return champions?.find((champion) => champion.championId === championId) ?? null
}

/**
 * What to show when there is no label. The id itself, so a page is diagnosable ("Champion #9001")
 * instead of blank — a dump that lags a patch by a day must not make yesterday's pick unreadable.
 */
export function unknownChampionName(championId: number): string {
  return `Champion #${championId}`
}
