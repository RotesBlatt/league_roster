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
  division: Division
}

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
 * The league payload → the two ranks we store. Only our own queues and vocabulary survive:
 * a tier Riot invented last week is dropped, not written to a column whose CHECK would reject it.
 * The first entry for a queue wins, so the result is a snapshot rather than a merge.
 */
export function toRanks(entries: readonly WireLeagueEntry[]): Ranks {
  const ranks: Ranks = { solo: null, flex: null }

  for (const entry of entries) {
    if (entry.queueType !== 'RANKED_SOLO_5x5' && entry.queueType !== 'RANKED_FLEX_SR') continue
    if (!isTier(entry.tier) || !isDivision(entry.rank)) continue

    const slot = entry.queueType === 'RANKED_SOLO_5x5' ? 'solo' : 'flex'
    if (ranks[slot]) continue

    ranks[slot] = { tier: entry.tier, division: entry.rank }
  }

  return ranks
}
