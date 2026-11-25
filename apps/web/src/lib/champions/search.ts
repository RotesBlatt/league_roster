import type { ChampionLabelDto } from '@lol/api/schema-types'

/**
 * The champion picker's search (champion-pools.md §7).
 *
 * League names carry punctuation and the odd accent — `Kai'Sa`, `K'Sante`, `Nunu & Willump`,
 * `Kha'Zix` — so matching is done on a **normalised** form of both the query and the champion:
 * lowercased, diacritics folded, everything that is not a letter or a digit removed. That makes
 * `kaisa`, `Kai'Sa` and `KAI SA` the same search, which is the only behaviour a picker can have.
 *
 * Pure and testable without a render: the picker is a list of chips over this result.
 */

/** Lowercase, fold diacritics, keep letters and digits only. */
export function normalizeChampionQuery(value: string): string {
  return (
    value
      .normalize('NFD')
      // combining marks left behind by NFD: "é" -> "e"
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
  )
}

/**
 * Champions matching `query`, best first: a prefix match on the name outranks a match in the
 * middle, then alphabetical. An empty query returns the cache by name (bounded by `limit`) so the
 * picker shows something to click instead of a blank box.
 */
export function searchChampions(
  champions: readonly ChampionLabelDto[] | undefined,
  query: string,
  limit = 40,
): ChampionLabelDto[] {
  const all = champions ?? []
  const needle = normalizeChampionQuery(query)

  if (needle === '') {
    return [...all].sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit)
  }

  return all
    .map((champion) => {
      const name = normalizeChampionQuery(champion.name)
      const slug = normalizeChampionQuery(champion.slug)

      // 0 = starts with it, 1 = contains it in the name, 2 = only the slug matches, -1 = no match
      const rank = name.startsWith(needle)
        ? 0
        : name.includes(needle)
          ? 1
          : slug.includes(needle)
            ? 2
            : -1

      return { champion, rank }
    })
    .filter((entry) => entry.rank >= 0)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.champion.name.localeCompare(b.champion.name) ||
        a.champion.championId - b.champion.championId,
    )
    .slice(0, limit)
    .map((entry) => entry.champion)
}
