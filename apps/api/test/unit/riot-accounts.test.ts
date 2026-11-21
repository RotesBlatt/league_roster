import { describe, expect, test } from 'bun:test'
import { normalizeRiotAccountId, toRiotAccountDto } from '../../src/lib/riot-accounts.ts'

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
    })

    expect(dto).toEqual({
      id: 'acc-1',
      gameName: 'Hide on bush',
      tagLine: 'EUW',
      platform: 'euw1',
      isMain: true,
      verifiedAt: Date.parse('2026-01-02T03:04:05.000Z'),
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
    })

    expect(dto.verifiedAt).toBeNull()
    expect(dto.isMain).toBe(false)
  })
})
