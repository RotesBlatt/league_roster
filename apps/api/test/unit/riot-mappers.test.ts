import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { toRanks, toRiotError } from '../../src/riot/mappers.ts'
import { parseAccount, parseLeague, parseSummoner } from '../../src/riot/wire.ts'

/**
 * The pure half of the Riot client (riot-api.md §6, §9). These functions are the reason the client
 * can be injected: every decision about a payload or a status is made here, against recorded data,
 * instead of in a route and against the network.
 */

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dir, '../fixtures/riot', name), 'utf8'))

describe('toRiotError', () => {
  test('404 means "no such Riot ID or the wrong region" — one sentence, because the two look alike', () => {
    expect(toRiotError(404)).toEqual({ kind: 'not_found' })
  })

  test('400 is a malformed input, which the form can point at', () => {
    expect(toRiotError(400)).toEqual({ kind: 'bad_request' })
  })

  test('401 and 403 are the operator’s problem, not the player’s', () => {
    expect(toRiotError(401)).toEqual({ kind: 'forbidden' })
    expect(toRiotError(403)).toEqual({ kind: 'forbidden' })
  })

  test('429 carries Retry-After when Riot sent one', () => {
    expect(toRiotError(429, '7')).toEqual({ kind: 'rate_limited', retryAfterSeconds: 7 })
  })

  test('429 without the header says nothing about when to retry', () => {
    expect(toRiotError(429)).toEqual({ kind: 'rate_limited', retryAfterSeconds: null })
    expect(toRiotError(429, 'not-a-number')).toEqual({
      kind: 'rate_limited',
      retryAfterSeconds: null,
    })
  })

  test('5xx is "Riot is having a day", and so is any status we did not plan for', () => {
    expect(toRiotError(500)).toEqual({ kind: 'unavailable' })
    expect(toRiotError(503)).toEqual({ kind: 'unavailable' })
    expect(toRiotError(418)).toEqual({ kind: 'unavailable' })
  })
})

describe('toRanks', () => {
  test('solo and flex are read from the same payload', () => {
    expect(toRanks(parseLeague(fixture('league.json')) ?? [])).toEqual({
      solo: { tier: 'GOLD', division: 'II' },
      flex: { tier: 'SILVER', division: 'IV' },
    })
  })

  test('unranked is two empty slots, not an error', () => {
    expect(toRanks([])).toEqual({ solo: null, flex: null })
  })

  test('a queue we do not want is ignored, even when it is ranked', () => {
    expect(toRanks([{ queueType: 'RANKED_TFT', tier: 'CHALLENGER', rank: 'I' }])).toEqual({
      solo: null,
      flex: null,
    })
  })

  test('a tier we do not know is dropped rather than stored', () => {
    expect(toRanks([{ queueType: 'RANKED_SOLO_5x5', tier: 'WOOD', rank: 'I' }])).toEqual({
      solo: null,
      flex: null,
    })
  })

  test('a missing or unknown division is dropped — half a rank is worse than none', () => {
    expect(toRanks([{ queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: '' }])).toEqual({
      solo: null,
      flex: null,
    })
    expect(toRanks([{ queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'IX' }])).toEqual({
      solo: null,
      flex: null,
    })
  })

  test('solo wins when Riot sends it twice — the first entry is the snapshot', () => {
    expect(
      toRanks([
        { queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'II' },
        { queueType: 'RANKED_SOLO_5x5', tier: 'DIAMOND', rank: 'IV' },
      ]),
    ).toEqual({ solo: { tier: 'GOLD', division: 'II' }, flex: null })
  })
})

describe('parseAccount', () => {
  test('the recorded payload becomes our shape', () => {
    expect(parseAccount(fixture('account.json'))).toEqual({
      puuid: 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789-_aBcDeFgHiJkLmNoPqRsTuVwXyZ',
      gameName: 'Hide on bush',
      tagLine: 'EUW',
    })
  })

  test('the canonical name is kept as Riot returns it — that is how a rename is picked up', () => {
    expect(parseAccount({ puuid: 'p', gameName: 'New Name', tagLine: 'TAG' })).toEqual({
      puuid: 'p',
      gameName: 'New Name',
      tagLine: 'TAG',
    })
  })

  test('anything missing the identity is null, not a half-filled account', () => {
    for (const body of [
      null,
      undefined,
      'nope',
      [],
      {},
      { puuid: '' },
      { puuid: 'p' },
      { puuid: 'p', gameName: 'Name' },
      { puuid: 42, gameName: 'Name', tagLine: 'TAG' },
    ]) {
      expect(parseAccount(body)).toBeNull()
    }
  })
})

describe('parseSummoner', () => {
  test('the recorded payload becomes our shape, and the deprecated id is not copied', () => {
    expect(parseSummoner(fixture('summoner.json'))).toEqual({
      summonerLevel: 512,
      profileIconId: 4568,
    })
  })

  test('level 0 and icon 0 are valid values, not "missing"', () => {
    expect(parseSummoner({ summonerLevel: 0, profileIconId: 0 })).toEqual({
      summonerLevel: 0,
      profileIconId: 0,
    })
  })

  test('a missing or wrongly typed field is null — the account stays without a level', () => {
    for (const body of [
      null,
      {},
      { summonerLevel: 5 },
      { profileIconId: 5 },
      { summonerLevel: '5', profileIconId: 5 },
      { summonerLevel: 5.5, profileIconId: 5 },
    ]) {
      expect(parseSummoner(body)).toBeNull()
    }
  })
})

describe('parseLeague', () => {
  test('keeps the entries we can read and drops the rest', () => {
    const entries = parseLeague(fixture('league.json'))

    expect(entries).toHaveLength(3)
    expect(entries?.[0]).toEqual({ queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'II' })
  })

  test('an unranked player is an empty array, not null', () => {
    expect(parseLeague([])).toEqual([])
  })

  test('a body that is not an array is null — the caller cannot tell "unranked" from it', () => {
    for (const body of [null, undefined, {}, 'nope', 42]) {
      expect(parseLeague(body)).toBeNull()
    }
  })

  test('entries with no queue or tier are dropped, not coerced', () => {
    expect(
      parseLeague([
        { tier: 'GOLD', rank: 'I' },
        { queueType: 'RANKED_SOLO_5x5', rank: 'I' },
        { queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'I' },
        'nope',
        null,
      ]),
    ).toEqual([{ queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'I' }])
  })
})
