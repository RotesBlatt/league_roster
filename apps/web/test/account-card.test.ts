import { describe, expect, test } from 'bun:test'
import { levelLabel, ranksToShow } from '../src/account-card.ts'

/**
 * The account card's decisions, tested without a DOM. The rules that matter: a divisionless tier
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
