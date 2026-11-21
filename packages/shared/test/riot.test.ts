import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_RIOT_PLATFORM,
  DIVISIONS,
  isDivision,
  isPlatform,
  isQueue,
  isTier,
  PLATFORM_LABELS,
  platformRegion,
  QUEUES,
  RIOT_PLATFORMS,
  TIERS,
} from '../src/index.ts'

/**
 * The rank vocabulary the Riot client and the profile card share (quick-wins A3: these constants
 * were tested dead code until a consumer existed). The platform list is the one Riot's own spec
 * advertises on the platform-hosted endpoints — a fact about Riot, not about our data.
 */

describe('RIOT_PLATFORMS', () => {
  test('is the platform list Riot serves, without duplicates', () => {
    expect([...RIOT_PLATFORMS]).toHaveLength(15)
    expect(new Set(RIOT_PLATFORMS).size).toBe(RIOT_PLATFORMS.length)
  })

  test('the default is one of them, and it is a platform host not a regional route', () => {
    expect(DEFAULT_RIOT_PLATFORM).toBe('euw1')
    expect(RIOT_PLATFORMS).toContain(DEFAULT_RIOT_PLATFORM)
    expect(RIOT_PLATFORMS).not.toContain('europe')
  })

  test('every platform has a label a person recognises', () => {
    for (const platform of RIOT_PLATFORMS) {
      expect(PLATFORM_LABELS[platform].length).toBeGreaterThan(0)
    }
  })

  test('the guard accepts exactly those codes — a regional route is not a platform', () => {
    for (const platform of RIOT_PLATFORMS) expect(isPlatform(platform)).toBe(true)
    for (const value of ['europe', 'EUW1', '', null, undefined, 42, {}]) {
      expect(isPlatform(value)).toBe(false)
    }
  })
})

describe('platformRegion', () => {
  test('derives the regional route the account lookup needs', () => {
    expect(platformRegion('euw1')).toBe('europe')
    expect(platformRegion('eun1')).toBe('europe')
    expect(platformRegion('tr1')).toBe('europe')
    expect(platformRegion('ru')).toBe('europe')
    expect(platformRegion('me1')).toBe('europe')
    expect(platformRegion('na1')).toBe('americas')
    expect(platformRegion('br1')).toBe('americas')
    expect(platformRegion('kr')).toBe('asia')
    expect(platformRegion('oc1')).toBe('sea')
  })

  test('every platform has a region — storing the platform is enough', () => {
    for (const platform of RIOT_PLATFORMS) {
      expect(platformRegion(platform)).not.toBeNull()
    }
  })

  test('an unknown platform is null, not a guess', () => {
    expect(platformRegion('xx9')).toBeNull()
    expect(platformRegion('europe')).toBeNull()
    expect(platformRegion('')).toBeNull()
  })
})

describe('rank vocabulary guards', () => {
  test('known values pass, and are the shared constants', () => {
    for (const tier of TIERS) expect(isTier(tier)).toBe(true)
    for (const division of DIVISIONS) expect(isDivision(division)).toBe(true)
    for (const queue of QUEUES) expect(isQueue(queue)).toBe(true)
  })

  test('Riot’s case is the only accepted case', () => {
    expect(isTier('gold')).toBe(false)
    expect(isDivision('i')).toBe(false)
    expect(isQueue('ranked_solo_5x5')).toBe(false)
  })

  test('anything else is rejected without throwing', () => {
    for (const value of [null, undefined, 42, '', 'UNRANKED', {}, []]) {
      expect(isTier(value)).toBe(false)
      expect(isDivision(value)).toBe(false)
      expect(isQueue(value)).toBe(false)
    }
  })

  test('solo queue comes first: it is the primary rank the card shows', () => {
    expect(QUEUES[0]).toBe('RANKED_SOLO_5x5')
    expect(QUEUES[1]).toBe('RANKED_FLEX_SR')
  })
})
