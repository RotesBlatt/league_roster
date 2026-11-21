import type { RiotRankDto } from '@lol/api/schema-types'
import type { Queue, Tier } from '@lol/shared'

/**
 * How a stored rank is shown. Presentation only: the API stores `GOLD`/`II`, and every rule about
 * what that means lives here rather than in three components (same shape as `badges.tsx`).
 */
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
