import { describe, expect, test } from 'bun:test'
import { TIERS } from '@lol/shared'
import {
  levelLabel,
  QUEUE_SHORT_LABELS,
  rankLabel,
  rankQueueLabel,
  ranksToShow,
  TIER_COLORS,
} from '../../../src/lib/profile/rank.ts'

/**
 * Rank display is a pure mapping, so it is tested without a DOM: Riot's `GOLD`/`II` becomes
 * "Gold II", and the three divisionless tiers must never grow an "I" back (riot-api.md §6).
 */
describe('rankLabel', () => {
  test('a normal tier reads as tier and division', () => {
    expect(rankLabel({ tier: 'GOLD', division: 'II' })).toBe('Gold II')
    expect(rankLabel({ tier: 'IRON', division: 'IV' })).toBe('Iron IV')
  })

  test('Master and above read as the tier alone — there is no division to show', () => {
    expect(rankLabel({ tier: 'MASTER', division: null })).toBe('Master')
    expect(rankLabel({ tier: 'GRANDMASTER', division: null })).toBe('Grandmaster')
    expect(rankLabel({ tier: 'CHALLENGER', division: null })).toBe('Challenger')
  })
})

describe('TIER_COLORS', () => {
  test('every tier has a colour, so no rank renders grey by accident', () => {
    for (const tier of TIERS) expect(TIER_COLORS[tier].length).toBeGreaterThan(0)
  })
})

describe('rankQueueLabel', () => {
  test('a badge says which queue the rank is from — solo and flex are different facts', () => {
    expect(rankQueueLabel('RANKED_SOLO_5x5', { tier: 'GOLD', division: 'II' })).toBe('Solo Gold II')
    expect(rankQueueLabel('RANKED_FLEX_SR', { tier: 'SILVER', division: 'IV' })).toBe(
      'Flex Silver IV',
    )
  })

  test('the divisionless tiers keep their short queue word too', () => {
    expect(rankQueueLabel('RANKED_SOLO_5x5', { tier: 'CHALLENGER', division: null })).toBe(
      'Solo Challenger',
    )
  })

  test('every queue has a short label a badge can fit', () => {
    for (const label of Object.values(QUEUE_SHORT_LABELS)) {
      expect(label.length).toBeLessThanOrEqual(4)
    }
  })
})

/**
 * Which ranks a card shows, tested without a DOM. The rules that matter: a divisionless tier
 * is not a division of null, and an unverified account shows no level rather than a fake one.
 */
describe('ranksToShow', () => {
  test('solo leads, flex follows, and each rank carries its queue', () => {
    expect(
      ranksToShow({
        solo: { tier: 'GOLD', division: 'II' },
        flex: { tier: 'SILVER', division: 'IV' },
      }),
    ).toEqual([
      { queue: 'RANKED_SOLO_5x5', rank: { tier: 'GOLD', division: 'II' } },
      { queue: 'RANKED_FLEX_SR', rank: { tier: 'SILVER', division: 'IV' } },
    ])
  })

  test('absent queues are dropped, not rendered as blanks', () => {
    expect(ranksToShow({ solo: null, flex: null })).toEqual([])
    expect(ranksToShow({ solo: { tier: 'MASTER', division: null }, flex: null })).toEqual([
      { queue: 'RANKED_SOLO_5x5', rank: { tier: 'MASTER', division: null } },
    ])
  })
})

describe('levelLabel', () => {
  test('a fetched snapshot shows the level', () => {
    expect(levelLabel({ fetchedAt: 1, summonerLevel: 512 })).toBe('Level 512')
  })

  test('no snapshot (unverified) shows nothing — not "Level null"', () => {
    expect(levelLabel({ fetchedAt: null, summonerLevel: null })).toBeNull()
    expect(levelLabel({ fetchedAt: null, summonerLevel: 512 })).toBeNull()
  })

  test('a partial lookup fetched no level, so nothing is claimed', () => {
    expect(levelLabel({ fetchedAt: 1, summonerLevel: null })).toBeNull()
  })
})
