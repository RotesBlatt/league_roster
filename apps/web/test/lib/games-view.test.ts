import { describe, expect, test } from 'bun:test'
import type { MatchGameDto, MatchLaneRefDto } from '@lol/api/schema-types'
import {
  formatGameTime,
  formatKda,
  GAMES_SCOPE_OPTIONS,
  groupByMatch,
  kindLabel,
  laneCell,
  provenanceLabel,
  RESULT_TONE,
  resultText,
  resultTone,
  teamCountText,
} from '../../src/lib/matches/games-view.ts'

/**
 * The games list's rendering rules (match-history.md §9), as plain functions.
 *
 * Everything here is the part that can be wrong *silently*: a `–` that became `0/0/0`, a game whose
 * five rows render as five unrelated games, a score line that says `5/10`. The page itself only
 * arranges what these return.
 */

function game(overrides: Partial<MatchGameDto> = {}): MatchGameDto {
  return {
    matchId: 'm-1',
    gameStartAt: '2026-11-09T19:15:00.000Z',
    kind: 'flex',
    provenance: 'riot',
    isRemake: false,
    queueId: 440,
    durationSeconds: 1800,
    teamCount: 3,
    player: { userId: 'u1', displayName: 'Mack', account: 'ACE Mack#021' },
    championId: 103,
    role: 'MID',
    win: true,
    kills: 7,
    deaths: 3,
    assists: 11,
    cs: 210,
    goldEarned: 12_000,
    visionScore: 24,
    lane: { partner: null, laneOpponent: null, opponentPartner: null },
    note: null,
    ...overrides,
  }
}

describe('the scope selector', () => {
  test('offers the six scopes the doc names, in that order, with German labels', () => {
    expect(GAMES_SCOPE_OPTIONS.map((option) => option.value)).toEqual([
      'all',
      'solo',
      'flex',
      'ranked5',
      'scrim',
      'tournament',
    ])
    expect(GAMES_SCOPE_OPTIONS.map((option) => option.label)).toEqual([
      'All',
      'SoloQ',
      'Flex',
      'Ranked 5v5',
      'Scrim',
      'Tournament',
    ])
  })
})

describe('formatKda', () => {
  test('a normal game reads k/d/a', () => {
    expect(formatKda(game())).toBe('7/3/11')
  })

  test('a hand-entered scrim renders "–", never 0/0/0', () => {
    // the single most misleading thing this page could do: a scrim that had no KDA is not a 0/0/0
    expect(formatKda(game({ kills: null, deaths: null, assists: null }))).toBe('–')
  })

  test('one missing number is enough to make the whole cell unknown', () => {
    expect(formatKda(game({ deaths: null }))).toBe('–')
  })

  test('a real zero is a zero, not a dash', () => {
    expect(formatKda(game({ kills: 0, deaths: 0, assists: 0 }))).toBe('0/0/0')
  })
})

describe('resultText', () => {
  test('S and N, and a dash when nobody recorded it', () => {
    expect(resultText(true)).toBe('S')
    expect(resultText(false)).toBe('N')
    expect(resultText(null)).toBe('–')
  })
})

describe('resultTone', () => {
  test('the colours are theme tokens, not Mantine colour names', () => {
    // a token names the meaning, so a palette change is one edit — `c="green"` would hardcode a shade
    expect(resultTone(true)).toBe(RESULT_TONE.win)
    expect(resultTone(false)).toBe(RESULT_TONE.loss)
    expect(resultTone(null)).toBe(RESULT_TONE.unknown)
    for (const tone of Object.values(RESULT_TONE)) {
      expect(tone.startsWith('var(--mantine-color-')).toBe(true)
    }
  })

  test('unknown is its own tone: not played is not lost', () => {
    expect(resultTone(null)).not.toBe(resultTone(false))
  })
})

describe('provenanceLabel and kindLabel', () => {
  test('the row says where it came from — a league game missing is not the same as never played', () => {
    expect(provenanceLabel('riot')).toBe('Riot')
    expect(provenanceLabel('manual')).toBe('Manual')
  })

  test('every kind has a label', () => {
    expect(kindLabel('solo')).toBe('SoloQ')
    expect(kindLabel('flex')).toBe('Flex')
    expect(kindLabel('ranked5')).toBe('Ranked 5v5')
    expect(kindLabel('normal')).toBe('Normal')
    expect(kindLabel('custom')).toBe('Custom')
    expect(kindLabel('tournament')).toBe('Tournament')
    expect(kindLabel('scrim')).toBe('Scrim')
    expect(kindLabel('other')).toBe('Other')
  })
})

describe('laneCell', () => {
  const ref = (overrides: Partial<MatchLaneRefDto> = {}): MatchLaneRefDto => ({
    puuid: 'p1',
    userId: null,
    displayName: null,
    championId: null,
    ...overrides,
  })

  test('a teammate is a name', () => {
    expect(laneCell(ref({ displayName: 'Member A' }))).toEqual({ kind: 'name', name: 'Member A' })
  })

  test('an enemy is a champion **id**, so the page can render its real name', () => {
    // it used to be the string "Champion 24": the id is not a label, and the cache has the label
    expect(laneCell(ref({ championId: 24 }))).toEqual({ kind: 'champion', championId: 24 })
  })

  test('a name wins over a champion id', () => {
    expect(laneCell(ref({ displayName: 'Member A', championId: 24 }))).toEqual({
      kind: 'name',
      name: 'Member A',
    })
  })

  test('nothing known is an empty cell, not an invented champion', () => {
    expect(laneCell(null)).toEqual({ kind: 'none' })
    expect(laneCell(ref())).toEqual({ kind: 'none' })
  })
})

describe('teamCountText', () => {
  test('is a fraction of five, on our side', () => {
    expect(teamCountText(3)).toBe('3/5')
    expect(teamCountText(5)).toBe('5/5')
    expect(teamCountText(1)).toBe('1/5')
  })
})

describe('formatGameTime', () => {
  test('renders the instant in the team’s timezone, not the server’s', () => {
    // 19:15 UTC in November is 20:15 in Berlin — proving the zone is honoured, not ignored
    expect(formatGameTime('2026-11-09T19:15:00.000Z', 'Europe/Berlin')).toBe('09.11. 20:15')
  })

  test('a summer instant lands on CEST, an hour apart from the same clock in winter', () => {
    expect(formatGameTime('2026-07-01T19:15:00.000Z', 'Europe/Berlin')).toBe('01.07. 21:15')
  })

  test('an unparseable instant is a dash rather than "Invalid Date"', () => {
    expect(formatGameTime('not-a-date', 'Europe/Berlin')).toBe('–')
  })
})

describe('groupByMatch', () => {
  test('one game with three of ours is one group, not three games', () => {
    const groups = groupByMatch([
      game({ matchId: 'm-1', player: { userId: 'u1', displayName: 'A', account: null } }),
      game({ matchId: 'm-1', player: { userId: 'u2', displayName: 'B', account: null } }),
      game({ matchId: 'm-2', player: { userId: 'u3', displayName: 'C', account: null } }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0]?.rows).toHaveLength(2)
    expect(groups[1]?.rows).toHaveLength(1)
  })

  test('the order of groups and of rows inside them follows the input', () => {
    const groups = groupByMatch([
      game({ matchId: 'm-2' }),
      game({ matchId: 'm-1' }),
      game({ matchId: 'm-2' }),
    ])
    expect(groups.map((group) => group.matchId)).toEqual(['m-2', 'm-1'])
    expect(groups[0]?.rows).toHaveLength(2)
  })

  test('an empty page is no groups', () => {
    expect(groupByMatch([])).toEqual([])
  })
})
