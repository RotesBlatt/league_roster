import { type Division, isDivision, isTier, type Tier } from '@lol/shared'
import type { WireLeagueEntry } from './wire.ts'

/**
 * Status → value, not exception (riot-api.md §6). Each kind is a different sentence to a different
 * person: `not_found` is the player's typo, `forbidden` is our dead API key. Merging them sends
 * people editing the wrong thing.
 */
export type RiotError =
  | { kind: 'not_found' }
  | { kind: 'bad_request' }
  | { kind: 'rate_limited'; retryAfterSeconds: number | null }
  | { kind: 'forbidden' }
  | { kind: 'unavailable' }
  | { kind: 'timeout' }

/** A tier and a division, without the queue: which queue it is, the field name already says. */
export type Rank = {
  tier: Tier
  /** null above Diamond: Master, Grandmaster and Challenger have no divisions. */
  division: Division | null
}

/** The tiers that carry no division — LP is their only progress signal. */
const DIVISIONLESS_TIERS: readonly Tier[] = ['MASTER', 'GRANDMASTER', 'CHALLENGER']

/** Both ranked queues, independently optional — playing one and not the other is normal. */
export type Ranks = {
  solo: Rank | null
  flex: Rank | null
}

/** `Retry-After` is seconds on Riot's 429; anything unparseable means "we do not know". */
function retryAfterSeconds(header: string | null | undefined): number | null {
  if (header === null || header === undefined) return null

  const seconds = Number(header)
  return Number.isInteger(seconds) && seconds >= 0 ? seconds : null
}

/**
 * Riot's status codes, as the five things they actually mean. 401 is folded into 403 on purpose:
 * both mean our key, not the player, and the UI sentence is the same.
 */
export function toRiotError(status: number, retryAfter?: string | null): RiotError {
  if (status === 404) return { kind: 'not_found' }
  if (status === 400) return { kind: 'bad_request' }
  if (status === 401 || status === 403) return { kind: 'forbidden' }
  if (status === 429)
    return { kind: 'rate_limited', retryAfterSeconds: retryAfterSeconds(retryAfter) }
  return { kind: 'unavailable' }
}

/**
 * One entry → one rank. Master and above keep their tier and drop the division, because the game
 * has none there — verified live on EUW1 (2026-11-21): all 300 challenger, 700 grandmaster and
 * 10 000 master entries carried `rank: "I"`, and `entries/by-puuid` answered the same. Riot does
 * not send a null we could key on, so this is a decision here, not a field to trust.
 * Below Diamond a division is required; an unreadable one drops the rank rather than half-store it.
 */
function toRank(entry: WireLeagueEntry): Rank | null {
  if (!isTier(entry.tier)) return null
  if (DIVISIONLESS_TIERS.includes(entry.tier)) return { tier: entry.tier, division: null }

  return isDivision(entry.rank) ? { tier: entry.tier, division: entry.rank } : null
}

/**
 * The league payload → the two ranks we store. Only our own queues and vocabulary survive:
 * a tier Riot invented last week is dropped, not written to a column whose CHECK would reject it.
 * The first entry for a queue wins, so the result is a snapshot rather than a merge.
 */
export function toRanks(entries: readonly WireLeagueEntry[]): Ranks {
  const ranks: Ranks = { solo: null, flex: null }

  for (const entry of entries) {
    if (entry.queueType !== 'RANKED_SOLO_5x5' && entry.queueType !== 'RANKED_FLEX_SR') continue

    const slot = entry.queueType === 'RANKED_SOLO_5x5' ? 'solo' : 'flex'
    if (ranks[slot]) continue

    ranks[slot] = toRank(entry)
  }

  return ranks
}
