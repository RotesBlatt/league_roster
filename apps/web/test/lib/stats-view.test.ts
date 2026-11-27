import { describe, expect, test } from 'bun:test'
import type { MatchGameDto } from '@lol/api/schema-types'
import {
  formatStatsDate,
  formatWinrate,
  formatWinsLosses,
  gameLine,
  minutesLabel,
  playerKpis,
} from '../../src/lib/matches/stats-view.ts'

/**
 * The stats page's cells (match-history.md §8, §9) — the screenshot's `25.11.2026`, `9 / 5`, `64%`,
 * `1/4/22 KDA · 201 CS · 35 Min · MIDDLE`.
 *
 * Same rule as everywhere else in this feature: a number we do not have renders `–`, never `0`. The
 * page must be able to say "we do not know" without inventing a value.
 */

const game = (overrides: Partial<MatchGameDto> = {}): MatchGameDto =>
  ({
    matchId: 'm1',
    gameStartAt: '2026-11-25T18:04:00.000Z',
    kind: 'flex',
    provenance: 'riot',
    isRemake: false,
    queueId: 440,
    durationSeconds: 2100,
    teamCount: 5,
    player: { userId: 'u1', displayName: 'Joni', account: 'RotesBlatt#401' },
    championId: 103,
    role: 'MID',
    win: true,
    kills: 1,
    deaths: 4,
    assists: 22,
    cs: 201,
    goldEarned: 9000,
    visionScore: 20,
    lane: { partner: null, laneOpponent: null, opponentPartner: null },
    note: null,
    ...overrides,
  }) as MatchGameDto

describe('formatStatsDate', () => {
  test('renders the day, month and year the screenshot shows', () => {
    expect(formatStatsDate('2026-11-25T18:04:00.000Z', 'Europe/Berlin')).toBe('25.11.2026')
  })

  test('an unparseable instant is a dash', () => {
    expect(formatStatsDate('nope')).toBe('–')
  })
})

describe('formatWinrate', () => {
  test('is a whole percent', () => {
    expect(formatWinrate(64)).toBe('64%')
    expect(formatWinrate(100)).toBe('100%')
  })

  test('no games is a dash, not 0%', () => {
    // the single most misleading cell this page could produce
    expect(formatWinrate(null)).toBe('–')
  })
})

describe('formatWinsLosses', () => {
  test('is "9 / 5", spaced like the sheet', () => {
    expect(formatWinsLosses(9, 5)).toBe('9 / 5')
    expect(formatWinsLosses(0, 0)).toBe('0 / 0')
  })
})

describe('minutesLabel', () => {
  test('rounds a duration to whole minutes', () => {
    expect(minutesLabel(2100)).toBe('35 Min')
  })

  test('an unknown duration is a dash — a hand-entered row has none', () => {
    expect(minutesLabel(null)).toBe('–')
  })
})

describe('gameLine', () => {
  test('joins KDA, CS, minutes and role in that order', () => {
    expect(gameLine(game(), 'Europe/Berlin')).toContain('1/4/22 KDA')
    expect(gameLine(game(), 'Europe/Berlin')).toContain('201 CS')
    expect(gameLine(game(), 'Europe/Berlin')).toContain('35 Min')
    expect(gameLine(game(), 'Europe/Berlin')).toContain('Mid')
  })

  test('a hand-entered row keeps only what it has — no 0/0/0, no invented minutes', () => {
    const line = gameLine(
      game({ kills: null, deaths: null, assists: null, cs: null, durationSeconds: null }),
      'Europe/Berlin',
    )
    expect(line).not.toContain('KDA')
    expect(line).not.toContain('CS')
    expect(line).not.toContain('Min')
    // the role is still known, so the cell is not empty
    expect(line).toBe('Mid')
  })

  test('nothing known at all is a single dash', () => {
    const line = gameLine(
      game({
        kills: null,
        deaths: null,
        assists: null,
        cs: null,
        durationSeconds: null,
        role: null,
      }),
      'Europe/Berlin',
    )
    expect(line).toBe('–')
  })
})

describe('playerKpis', () => {
  test('turns a player row into the four cards', () => {
    const kpis = playerKpis({
      userId: 'u1',
      displayName: 'Joni',
      role: 'MID',
      isActive: true,
      games: 14,
      wins: 9,
      losses: 5,
      winrate: 64,
      lastPlayedAt: '2026-11-25T18:04:00.000Z',
      champions: [],
    })
    expect(kpis).toEqual({
      games: '14',
      winrate: '64%',
      record: '9 / 5',
      lastPlayed: '25.11.2026',
    })
  })

  test('a player with no games shows dashes where a number would be a lie', () => {
    const kpis = playerKpis({
      userId: 'u2',
      displayName: 'New',
      role: null,
      isActive: true,
      games: 0,
      wins: 0,
      losses: 0,
      winrate: null,
      lastPlayedAt: null,
      champions: [],
    })
    expect(kpis).toEqual({ games: '0', winrate: '–', record: '0 / 0', lastPlayed: '–' })
  })
})
