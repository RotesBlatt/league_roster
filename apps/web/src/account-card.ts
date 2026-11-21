import type { RiotAccountDto, RiotRankDto } from '@lol/api/schema-types'
import type { Queue } from '@lol/shared'

/**
 * The few decisions the account card makes, kept out of the component so they can be tested
 * without a DOM (same shape as `rank.ts`). Everything here is presentation: the API owns what a
 * snapshot *is*.
 */

export type RankPair = RiotAccountDto['ranks']

/** A rank together with the queue it belongs to — a badge has to say which one it means. */
export type ShownRank = { queue: Queue; rank: RiotRankDto }

/** Solo first, then flex — the queue a player cares about leads, and absent queues are dropped. */
export function ranksToShow(ranks: RankPair | null | undefined): ShownRank[] {
  // `undefined` is a row written by a build before ranks existed: the query cache survives HMR
  if (!ranks) return []

  const shown: ShownRank[] = []
  if (ranks.solo) shown.push({ queue: 'RANKED_SOLO_5x5', rank: ranks.solo })
  if (ranks.flex) shown.push({ queue: 'RANKED_FLEX_SR', rank: ranks.flex })
  return shown
}

/**
 * "Level 512" for a row that has a snapshot, `null` otherwise. An unverified row must show
 * nothing rather than "Level null": absence of a lookup is a state, not a value.
 */
export function levelLabel(row: {
  fetchedAt?: number | null
  summonerLevel?: number | null
}): string | null {
  if (row.fetchedAt == null || row.summonerLevel == null) return null
  return `Level ${row.summonerLevel}`
}
