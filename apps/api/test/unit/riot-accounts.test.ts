import { describe, expect, test } from 'bun:test'
import {
  normalizeRiotAccountId,
  snapshotFields,
  toRiotAccountDto,
} from '../../src/lib/riot-accounts.ts'

/**
 * A Riot ID is `gameName#tagLine` — a *label*, not an identity (riot-api.md §2). Until validation
 * exists, these rules only keep the label usable: trimmed, present, bounded. Riot's real limits
 * are not copied from memory; the generous bounds below are placeholders to replace with the
 * verified ones when the client lands.
 */
describe('normalizeRiotAccountId', () => {
  test('trims both halves and keeps the case the player typed', () => {
    const { values, problems } = normalizeRiotAccountId({
      gameName: '  Hide on bush ',
      tagLine: ' EUW ',
    })

    expect(problems).toEqual([])
    expect(values).toEqual({ gameName: 'Hide on bush', tagLine: 'EUW' })
  })

  test('a missing game name is a field error', () => {
    const { problems } = normalizeRiotAccountId({ gameName: '   ', tagLine: 'EUW' })

    expect(problems).toEqual([{ field: 'gameName', message: 'Game name is required' }])
  })

  test('a missing tag line is a field error — the Riot ID is not complete without it', () => {
    const { problems } = normalizeRiotAccountId({ gameName: 'Hide on bush', tagLine: '' })

    expect(problems).toEqual([{ field: 'tagLine', message: 'Tag line is required' }])
  })

  test('both halves too long are both reported', () => {
    const { problems } = normalizeRiotAccountId({
      gameName: 'x'.repeat(33),
      tagLine: 'y'.repeat(17),
    })

    expect(problems.map((problem) => problem.field)).toEqual(['gameName', 'tagLine'])
  })

  test('the bounds themselves are accepted', () => {
    const { problems } = normalizeRiotAccountId({
      gameName: 'x'.repeat(32),
      tagLine: 'y'.repeat(16),
    })

    expect(problems).toEqual([])
  })
})

describe('toRiotAccountDto', () => {
  test('exposes the label and main flag, and dates as epoch ms or null', () => {
    // the input is the six exposed fields; `toEqual` below pins that nothing else gets added
    const dto = toRiotAccountDto({
      id: 'acc-1',
      gameName: 'Hide on bush',
      tagLine: 'EUW',
      platform: 'euw1',
      isMain: true,
      verifiedAt: new Date('2026-01-02T03:04:05.000Z'),
      fetchedAt: new Date('2026-01-02T03:04:05.000Z'),
      summonerLevel: 512,
      profileIconId: 4568,
      soloTier: 'GOLD',
      soloDivision: 'II',
      flexTier: 'MASTER',
      flexDivision: null,
    })

    expect(dto).toEqual({
      id: 'acc-1',
      gameName: 'Hide on bush',
      tagLine: 'EUW',
      platform: 'euw1',
      isMain: true,
      verifiedAt: Date.parse('2026-01-02T03:04:05.000Z'),
      fetchedAt: Date.parse('2026-01-02T03:04:05.000Z'),
      summonerLevel: 512,
      profileIconId: 4568,
      ranks: {
        solo: { tier: 'GOLD', division: 'II' },
        // Master+ has no division; the DTO says so with null, not with a fake "I"
        flex: { tier: 'MASTER', division: null },
      },
    })
  })

  test('an account that was never checked is unverified (null), not "unverified since 1970"', () => {
    const dto = toRiotAccountDto({
      id: 'acc-2',
      gameName: 'Smurf',
      tagLine: 'EUW',
      platform: 'euw1',
      isMain: false,
      verifiedAt: null,
      fetchedAt: null,
      summonerLevel: null,
      profileIconId: null,
      soloTier: null,
      soloDivision: null,
      flexTier: null,
      flexDivision: null,
    })

    expect(dto.verifiedAt).toBeNull()
    expect(dto.isMain).toBe(false)
  })
})

/** The two timestamps have two meanings; that is the whole point of the function (riot-api.md §5). */
describe('snapshotFields', () => {
  const now = new Date('2026-11-21T12:00:00.000Z')

  const account = {
    puuid: 'PUUID-1',
    gameName: 'Hide on bush',
    tagLine: 'EUW',
    summonerLevel: 512,
    profileIconId: 4568,
    ranks: {
      solo: { tier: 'GOLD' as const, division: 'II' as const },
      flex: { tier: 'MASTER' as const, division: null },
    },
  }

  test('a full lookup verifies and stamps fetchedAt with the same moment', () => {
    expect(snapshotFields({ ok: true, account, partial: false }, now)).toEqual({
      puuid: 'PUUID-1',
      summonerLevel: 512,
      profileIconId: 4568,
      soloTier: 'GOLD',
      soloDivision: 'II',
      flexTier: 'MASTER',
      flexDivision: null,
      verifiedAt: now,
      fetchedAt: now,
    })
  })

  test('a partial lookup keeps what arrived and stays unverified', () => {
    const partial = snapshotFields(
      { ok: true, account: { ...account, summonerLevel: null }, partial: true },
      now,
    )

    expect(partial.puuid).toBe('PUUID-1')
    expect(partial.summonerLevel).toBeNull()
    expect(partial.fetchedAt).toBe(now)
    expect(partial.verifiedAt).toBeNull()
  })

  test('an unranked player still verifies — no ranks is an answer, not a failure', () => {
    const unranked = snapshotFields(
      { ok: true, account: { ...account, ranks: { solo: null, flex: null } }, partial: false },
      now,
    )

    expect(unranked.verifiedAt).toBe(now)
    expect(unranked.soloTier).toBeNull()
    expect(unranked.flexTier).toBeNull()
  })

  test('a failed lookup writes nothing, not even fetchedAt', () => {
    const nothing = snapshotFields({ ok: false, error: { kind: 'forbidden' } }, now)

    expect(nothing).toEqual({
      puuid: null,
      summonerLevel: null,
      profileIconId: null,
      soloTier: null,
      soloDivision: null,
      flexTier: null,
      flexDivision: null,
      verifiedAt: null,
      fetchedAt: null,
    })
  })

  test('no lookup at all (throttled, no key) is the same as a failed one', () => {
    expect(snapshotFields(null, now)).toEqual(
      snapshotFields({ ok: false, error: { kind: 'timeout' } }, now),
    )
  })
})
