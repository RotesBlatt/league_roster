import { describe, expect, test } from 'bun:test'
import { TIERS } from '@lol/shared'
import { QUEUE_SHORT_LABELS, rankLabel, rankQueueLabel, TIER_COLORS } from '../src/rank.ts'

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
