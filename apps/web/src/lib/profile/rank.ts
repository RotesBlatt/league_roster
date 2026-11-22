import type { RiotAccountDto, RiotRankDto } from '@lol/api/schema-types'
import type { Queue, Tier } from '@lol/shared'

/**
 * How a stored rank is shown, and which ranks a card shows — presentation only.
 *
 * The API stores `GOLD`/`II` and owns what a snapshot *is*; every rule about what that means on
 * screen lives here rather than in three components. Same reason the two halves are one module:
 * a badge needs both "which queue leads" and "what the tier is called", and split across
 * `rank.ts` and `account-card.ts` the two only ever agreed by hand.
 *
 * Pure, so it is tested without a DOM: Riot's `GOLD`/`II` becomes "Gold II", and the three
 * divisionless tiers must never grow an "I" back (riot-api.md §6).
 */

/* ---------------------------------------------------------------- which ranks */

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

/* ---------------------------------------------------------------- one rank */

export const TIER_LABELS: Record<Tier, string> = {
  IRON: 'Iron',
  BRONZE: 'Bronze',
  SILVER: 'Silver',
  GOLD: 'Gold',
  PLATINUM: 'Platinum',
  EMERALD: 'Emerald',
  DIAMOND: 'Diamond',
  MASTER: 'Master',
  GRANDMASTER: 'Grandmaster',
  CHALLENGER: 'Challenger',
}

/** Mantine colour names, close enough to Riot's own palette to be recognisable. */
export const TIER_COLORS: Record<Tier, string> = {
  IRON: 'gray',
  BRONZE: 'orange',
  SILVER: 'gray',
  GOLD: 'yellow',
  PLATINUM: 'teal',
  EMERALD: 'green',
  DIAMOND: 'blue',
  MASTER: 'grape',
  GRANDMASTER: 'red',
  CHALLENGER: 'cyan',
}

/**
 * "Gold II", or just "Challenger". Master and above have no division, and Riot's `"I"` was dropped
 * at the boundary (riot-api.md §6) — this must never grow a fake division back.
 */
export function rankLabel(rank: RiotRankDto): string {
  const label = TIER_LABELS[rank.tier]
  return rank.division === null ? label : `${label} ${rank.division}`
}

/** Short enough for a badge: "Solo", not "Ranked Solo/Duo" (that lives in the shared package). */
export const QUEUE_SHORT_LABELS: Record<Queue, string> = {
  RANKED_SOLO_5x5: 'Solo',
  RANKED_FLEX_SR: 'Flex',
}

/**
 * The badge text: which queue the rank is from, then the rank. Solo and flex are different facts
 * about the same player, so a bar without the word would be unreadable.
 */
export function rankQueueLabel(queue: Queue, rank: RiotRankDto): string {
  return `${QUEUE_SHORT_LABELS[queue]} ${rankLabel(rank)}`
}

/* ---------------------------------------------------------------- the account */

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
