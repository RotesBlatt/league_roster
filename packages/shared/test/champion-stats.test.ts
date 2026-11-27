import { describe, expect, test } from 'bun:test'
import { championStats, type MatchStatRow, winrateTone } from '../src/champion-stats.ts'

/**
 * Champion stats — the numbers on the sheet's right-hand table (match-history.md §8, §8.1).
 *
 * This is the pure part of the feature: rows in, rows out, no DB and no React. The cases below are
 * the ones the doc insists on, because each of them is a way to be *confidently wrong* rather than
 * broken: a 0-game champion that renders `0%`, a 100%-from-one-game that looks like a 100%-from-ten,
 * a `lastPlayedAt` that comes from outside the selected scope, or a remake that counts as a loss.
 */

const at = (iso: string) => new Date(iso)

/** A decided Flex game for one player on one champion. */
function row(overrides: Partial<MatchStatRow> = {}): MatchStatRow {
  return {
    playerId: 'u1',
    championId: 103,
    win: true,
    gameStartAt: at('2026-11-01T18:00:00Z'),
    durationSeconds: 1800,
    queueId: 440,
    gameType: 'MATCHED_GAME',
    ...overrides,
  }
}

const stats = (rows: MatchStatRow[], scope: 'all' | 'solo' | 'flex' = 'all') =>
  championStats(rows, { scope })

describe('the shape of one row', () => {
  test('a champion played once, won, reads as 1 game / 100% — never as a percentage alone', () => {
    const [only] = stats([row()])
    expect(only).toMatchObject({
      playerId: 'u1',
      championId: 103,
      games: 1,
      wins: 1,
      losses: 0,
      winrate: 100,
    })
    expect(only?.lastPlayedAt).toEqual(at('2026-11-01T18:00:00Z'))
  })

  test('losses are games minus wins, so the three numbers can never disagree', () => {
    const [only] = stats([row({ win: true }), row({ win: false }), row({ win: false })])
    expect(only).toMatchObject({ games: 3, wins: 1, losses: 2 })
  })

  test('no rows is an empty list, not a row of zeroes', () => {
    expect(stats([])).toEqual([])
  })
})

describe('rounding (the sheet shows 17% for 1/6, so: round, never floor)', () => {
  test('2/3 is 67%, not 66%', () => {
    const [only] = stats([row(), row(), row({ win: false })])
    expect(only?.winrate).toBe(67)
  })

  test('1/3 is 33%', () => {
    const [only] = stats([row(), row({ win: false }), row({ win: false })])
    expect(only?.winrate).toBe(33)
  })

  test('1/6 is 17%', () => {
    const rows = [row(), ...Array.from({ length: 5 }, () => row({ win: false }))]
    const [only] = stats(rows)
    expect(only?.winrate).toBe(17)
  })

  test('an exact half is 50, not 49', () => {
    const [only] = stats([row(), row({ win: false })])
    expect(only?.winrate).toBe(50)
  })
})

describe('a person, not an account (§10.4)', () => {
  test('the same champion on two accounts of one player is one row', () => {
    const rows = [
      row({ gameStartAt: at('2026-11-01T18:00:00Z') }),
      row({ gameStartAt: at('2026-11-02T18:00:00Z') }),
    ]
    const result = stats(rows)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ games: 2, wins: 2 })
    // and the newest of the two accounts decides "last played"
    expect(result[0]?.lastPlayedAt).toEqual(at('2026-11-02T18:00:00Z'))
  })

  test('two players on the same champion are two rows', () => {
    const result = stats([row({ playerId: 'u1' }), row({ playerId: 'u2' })])
    expect(result.map((entry) => entry.playerId).sort()).toEqual(['u1', 'u2'])
    expect(result.every((entry) => entry.games === 1)).toBe(true)
  })
})

describe('the scope applies to every number in the row (§8.1)', () => {
  const mixed = [
    row({ queueId: 440, gameStartAt: at('2026-11-01T18:00:00Z'), win: true }),
    row({ queueId: 420, gameStartAt: at('2026-11-05T18:00:00Z'), win: false }),
  ]

  test('filtering to Flex drops the SoloQ game from games and wins', () => {
    const [only] = stats(mixed, 'flex')
    expect(only).toMatchObject({ games: 1, wins: 1, winrate: 100 })
  })

  test('… and from lastPlayedAt too, which is the half that reads as a data bug', () => {
    const [flex] = stats(mixed, 'flex')
    const [solo] = stats(mixed, 'solo')
    expect(flex?.lastPlayedAt).toEqual(at('2026-11-01T18:00:00Z'))
    expect(solo?.lastPlayedAt).toEqual(at('2026-11-05T18:00:00Z'))
  })

  test('"all" contains both', () => {
    const [only] = stats(mixed, 'all')
    expect(only).toMatchObject({ games: 2, wins: 1, losses: 1, winrate: 50 })
  })

  test('a scope with no games yields no champion row at all', () => {
    expect(stats([row({ queueId: 440 })], 'solo')).toEqual([])
  })

  test('the kind comes from resolveKind, so a scrim tag wins over the queue id', () => {
    const tagged = row({ queueId: 440, taggedKind: 'scrim' })
    expect(championStats([tagged], { scope: 'flex' })).toEqual([])
    expect(championStats([tagged], { scope: 'scrim' })[0]?.games).toBe(1)
  })

  test('an unknown queue id is "other" and counts only in "all"', () => {
    const odd = row({ queueId: 99999 })
    expect(championStats([odd], { scope: 'all' })[0]?.games).toBe(1)
    expect(championStats([odd], { scope: 'flex' })).toEqual([])
  })
})

describe('rows that cannot be counted are not counted', () => {
  test('a remake never contributes a game — and does not erase the older lastPlayedAt', () => {
    const rows = [
      row({ gameStartAt: at('2026-11-01T18:00:00Z'), win: true }),
      row({ gameStartAt: at('2026-11-09T18:00:00Z'), durationSeconds: 200, win: false }),
    ]
    const [only] = stats(rows)
    expect(only).toMatchObject({ games: 1, wins: 1, winrate: 100 })
    expect(only?.lastPlayedAt).toEqual(at('2026-11-01T18:00:00Z'))
  })

  test('a champion that was only ever remade has no row', () => {
    expect(stats([row({ durationSeconds: 180 })])).toEqual([])
  })

  test('a row with no decided result is not a game', () => {
    // the schema allows a NULL win for a manual row; a winrate built on it would be an invention
    expect(stats([row({ win: null })])).toEqual([])
  })

  test('a row without a duration is not a remake — a manual row must still count', () => {
    const [only] = stats([row({ durationSeconds: null })])
    expect(only?.games).toBe(1)
  })
})

describe('the order is deterministic', () => {
  test('more games first, then champion id — so two renders agree', () => {
    const rows = [
      row({ championId: 20, win: false }),
      row({ championId: 10 }),
      row({ championId: 10 }),
    ]
    expect(stats(rows).map((entry) => entry.championId)).toEqual([10, 20])
  })
})

describe('winrateTone', () => {
  test('the sheet’s colours: 56 and 100 green, 50 amber, 40 and 17 red', () => {
    expect(winrateTone(100, 1)).toBe('good')
    expect(winrateTone(56, 9)).toBe('good')
    expect(winrateTone(55, 9)).toBe('good')
    expect(winrateTone(50, 4)).toBe('meh')
    expect(winrateTone(45, 4)).toBe('meh')
    expect(winrateTone(44, 9)).toBe('bad')
    expect(winrateTone(40, 5)).toBe('bad')
    expect(winrateTone(17, 6)).toBe('bad')
  })

  test('no games is no tone — the cell renders "–", never a colour', () => {
    expect(winrateTone(null, 0)).toBe('none')
    expect(winrateTone(0, 0)).toBe('none')
  })

  test('0% from played games is red, not "none" — those are different statements', () => {
    expect(winrateTone(0, 3)).toBe('bad')
  })
})
