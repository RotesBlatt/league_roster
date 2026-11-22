/**
 * Everything that is Riot's vocabulary rather than ours: queues, tiers, divisions and the platform
 * host families.
 *
 * The guards here narrow a value from a request body or a stored row, so downstream code never
 * casts. Riot is not above sending a value outside its own documented set, and a bad tier must not
 * crash the page that renders it.
 */

export const QUEUES = ['RANKED_SOLO_5x5', 'RANKED_FLEX_SR'] as const
export type Queue = (typeof QUEUES)[number]

export const TIERS = [
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'EMERALD',
  'DIAMOND',
  'MASTER',
  'GRANDMASTER',
  'CHALLENGER',
] as const
export type Tier = (typeof TIERS)[number]

export const DIVISIONS = ['I', 'II', 'III', 'IV'] as const
export type Division = (typeof DIVISIONS)[number]

/**
 * The platform hosts Riot serves for LoL, as the pinned spec advertises them on the platform-scoped
 * endpoints. Storing the platform is enough: the regional route is derived, never stored, so the
 * two cannot drift (riot-api.md §2).
 */
export const RIOT_PLATFORMS = [
  'br1',
  'eun1',
  'euw1',
  'jp1',
  'kr',
  'la1',
  'la2',
  'me1',
  'na1',
  'oc1',
  'ru',
  'sg2',
  'tr1',
  'tw2',
  'vn2',
] as const
export type Platform = (typeof RIOT_PLATFORMS)[number]

/** Where a new account starts; changing it is a one-line decision, not a migration. */
export const DEFAULT_RIOT_PLATFORM: Platform = 'euw1'

export const PLATFORM_LABELS: Record<Platform, string> = {
  br1: 'Brazil',
  eun1: 'EU Nordic & East',
  euw1: 'EU West',
  jp1: 'Japan',
  kr: 'Korea',
  la1: 'Latin America North',
  la2: 'Latin America South',
  me1: 'Middle East',
  na1: 'North America',
  oc1: 'Oceania',
  ru: 'Russia',
  sg2: 'Singapore',
  tr1: 'Turkey',
  tw2: 'Taiwan',
  vn2: 'Vietnam',
}

/** The regional host families: account lookup lives here, summoner/rank on the platform host. */
export const RIOT_REGIONS = ['europe', 'americas', 'asia', 'sea'] as const
export type Region = (typeof RIOT_REGIONS)[number]

const PLATFORM_REGIONS: Record<Platform, Region> = {
  br1: 'americas',
  eun1: 'europe',
  euw1: 'europe',
  jp1: 'asia',
  kr: 'asia',
  la1: 'americas',
  la2: 'americas',
  me1: 'europe',
  na1: 'americas',
  oc1: 'sea',
  ru: 'europe',
  sg2: 'sea',
  tr1: 'europe',
  tw2: 'sea',
  vn2: 'sea',
}

/** The regional route for a platform code, or null when it is not one of ours. */
export function platformRegion(platform: string): Region | null {
  return (PLATFORM_REGIONS as Record<string, Region | undefined>)[platform] ?? null
}

/** Narrowing for a value from a request body or a row, so nothing downstream has to cast. */
export function isPlatform(value: unknown): value is Platform {
  return typeof value === 'string' && (RIOT_PLATFORMS as readonly string[]).includes(value)
}

export function isTier(value: unknown): value is Tier {
  return typeof value === 'string' && (TIERS as readonly string[]).includes(value)
}

export function isDivision(value: unknown): value is Division {
  return typeof value === 'string' && (DIVISIONS as readonly string[]).includes(value)
}

export function isQueue(value: unknown): value is Queue {
  return typeof value === 'string' && (QUEUES as readonly string[]).includes(value)
}
