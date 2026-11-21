import type { components, paths } from './generated/riot-api'

/**
 * The trust boundary (riot-api.md §2.1, §9). Riot's payloads are parsed here and nowhere else:
 * the generated DTOs say what Riot *says* it sends, these parsers decide what we actually accept.
 *
 * The wire types are `Required<Pick<generatedDto, …>>`: if Riot renames or removes a field we
 * store, this file stops compiling. Runtime validation stays narrow — a field we never read may
 * vanish without breaking anything.
 */

type AccountDto = components['schemas']['account-v1.AccountDto']
type SummonerDto = components['schemas']['summoner-v4.SummonerDTO']
type LeagueEntryDto = components['schemas']['league-v4.LeagueEntryDTO']

export type WireAccount = Required<Pick<AccountDto, 'puuid' | 'gameName' | 'tagLine'>>
export type WireSummoner = Required<Pick<SummonerDto, 'summonerLevel' | 'profileIconId'>>
export type WireLeagueEntry = Required<Pick<LeagueEntryDto, 'queueType' | 'tier' | 'rank'>>

/**
 * The only three paths this API calls, named against the generated spec so a rename is a compile
 * error rather than a 404 that looks like "no such player". Routes never build a URL (§1).
 */
export const RiotPaths = {
  accountByRiotId: '/riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}',
  summonerByPuuid: '/lol/summoner/v4/summoners/by-puuid/{encryptedPUUID}',
  leagueEntriesByPuuid: '/lol/league/v4/entries/by-puuid/{encryptedPUUID}',
} as const satisfies Record<string, keyof paths>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Non-empty string: Riot omits `gameName`/`tagLine` for accounts that have none. */
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0

/** Whole numbers only — `summonerLevel` arrives as an integer and a float would be a surprise. */
const isWholeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value)

/** `puuid`, plus the *canonical* label — which is how a re-resolve picks up a rename (§2). */
export function parseAccount(body: unknown): WireAccount | null {
  if (!isRecord(body)) return null

  const { puuid, gameName, tagLine } = body
  if (!isText(puuid) || !isText(gameName) || !isText(tagLine)) return null

  return { puuid, gameName, tagLine }
}

/** Level and icon; the deprecated `id`/`revisionDate` are deliberately not copied. */
export function parseSummoner(body: unknown): WireSummoner | null {
  if (!isRecord(body)) return null

  const { summonerLevel, profileIconId } = body
  if (!isWholeNumber(summonerLevel) || !isWholeNumber(profileIconId)) return null

  return { summonerLevel, profileIconId }
}

/**
 * One entry per ranked queue. `[]` is a valid answer — an unranked player — so `null` is reserved
 * for "this body is not a league list at all". Individual unreadable entries are dropped rather
 * than poisoning the list: a TFT entry with no `rank` must not cost us the solo one.
 */
export function parseLeague(body: unknown): WireLeagueEntry[] | null {
  if (!Array.isArray(body)) return null

  return body.flatMap((entry): WireLeagueEntry[] => {
    if (!isRecord(entry)) return []

    const { queueType, tier, rank } = entry
    if (!isText(queueType) || !isText(tier) || !isText(rank)) return []

    return [{ queueType, tier, rank }]
  })
}
