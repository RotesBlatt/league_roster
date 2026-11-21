import type { Division, Tier } from '@lol/shared'
import type { RiotAccountDto } from '../db/schema.types.ts'
import type { LookupResult } from '../riot/client.ts'

/**
 * A Riot ID is `gameName#tagLine` — the label a player recognises. It is **not** an identity:
 * renames change it, and `puuid` (once validation exists) is what stays stable (riot-api.md §2).
 *
 * These rules only keep the label usable: trimmed, present, bounded. Riot's real limits are
 * deliberately *not* copied from memory here — `player-profiles.md` §3 says to take them from the
 * live docs, and that happens when the client lands. Until then these are generous upper bounds.
 */
export const RIOT_GAME_NAME_MAX = 32
export const RIOT_TAG_LINE_MAX = 16

export type RiotAccountId = {
  gameName: string
  tagLine: string
}

export type RiotAccountIdProblem = {
  field: 'gameName' | 'tagLine'
  message: string
}

export type NormalizedRiotAccountId = {
  /** Best effort, trimmed: a reported field still has a safe value for the insert path. */
  values: RiotAccountId
  problems: RiotAccountIdProblem[]
}

export function normalizeRiotAccountId(input: RiotAccountId): NormalizedRiotAccountId {
  const gameName = input.gameName.trim()
  const tagLine = input.tagLine.trim()
  const problems: RiotAccountIdProblem[] = []

  if (gameName.length === 0) {
    problems.push({ field: 'gameName', message: 'Game name is required' })
  } else if (gameName.length > RIOT_GAME_NAME_MAX) {
    problems.push({
      field: 'gameName',
      message: `Game name must be at most ${RIOT_GAME_NAME_MAX} characters`,
    })
  }

  if (tagLine.length === 0) {
    problems.push({ field: 'tagLine', message: 'Tag line is required' })
  } else if (tagLine.length > RIOT_TAG_LINE_MAX) {
    problems.push({
      field: 'tagLine',
      message: `Tag line must be at most ${RIOT_TAG_LINE_MAX} characters`,
    })
  }

  return { values: { gameName, tagLine }, problems }
}

/**
 * Row → wire shape. `puuid` and `fetchedAt` stay internal: the UI has nothing to do with them,
 * and `verifiedAt === null` is the badge it *does* care about.
 */
/** The columns a lookup may write, in the shape the insert takes them. */
export type RiotAccountSnapshot = {
  puuid: string | null
  summonerLevel: number | null
  profileIconId: number | null
  soloTier: Tier | null
  soloDivision: Division | null
  flexTier: Tier | null
  flexDivision: Division | null
  verifiedAt: Date | null
  fetchedAt: Date | null
}

/**
 * What one lookup is allowed to write (riot-api.md §5). Two timestamps, two meanings:
 *
 * - `verifiedAt` only when all three calls succeeded — "this Riot ID resolved then";
 * - `fetchedAt` whenever data arrived at all — "the snapshot is from then" — which is why a
 *   *partial* answer stores the puuid and the level it has, yet stays unverified.
 *
 * `null` means "no lookup ran" (no key, our own throttle, a dead socket): an unverified row, which
 * is a perfectly valid row and not an error.
 */
export function snapshotFields(result: LookupResult | null, now: Date): RiotAccountSnapshot {
  if (result === null || !result.ok) {
    return {
      puuid: null,
      summonerLevel: null,
      profileIconId: null,
      soloTier: null,
      soloDivision: null,
      flexTier: null,
      flexDivision: null,
      verifiedAt: null,
      fetchedAt: null,
    }
  }

  const { account, partial } = result
  const { solo, flex } = account.ranks

  return {
    puuid: account.puuid,
    summonerLevel: account.summonerLevel,
    profileIconId: account.profileIconId,
    soloTier: solo?.tier ?? null,
    soloDivision: solo?.division ?? null,
    flexTier: flex?.tier ?? null,
    flexDivision: flex?.division ?? null,
    verifiedAt: partial ? null : now,
    fetchedAt: now,
  }
}

const toRank = (tier: Tier | null, division: Division | null) =>
  tier === null ? null : { tier, division }

export function toRiotAccountDto(row: {
  id: string
  gameName: string
  tagLine: string
  platform: string
  isMain: boolean
  verifiedAt: Date | null
  fetchedAt: Date | null
  summonerLevel: number | null
  profileIconId: number | null
  soloTier: Tier | null
  soloDivision: Division | null
  flexTier: Tier | null
  flexDivision: Division | null
}): RiotAccountDto {
  return {
    id: row.id,
    gameName: row.gameName,
    tagLine: row.tagLine,
    platform: row.platform,
    isMain: row.isMain,
    verifiedAt: row.verifiedAt?.getTime() ?? null,
    fetchedAt: row.fetchedAt?.getTime() ?? null,
    summonerLevel: row.summonerLevel,
    profileIconId: row.profileIconId,
    // which queue it is, the field name says: no `queue` inside a rank
    ranks: {
      solo: toRank(row.soloTier, row.soloDivision),
      flex: toRank(row.flexTier, row.flexDivision),
    },
  }
}
