import type { RiotRankDto } from '@lol/api/schema-types'
import type { Tier } from '@lol/shared'

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
