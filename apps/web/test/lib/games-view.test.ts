import { describe, expect, test } from 'bun:test'
import type { MatchLaneRefDto } from '@lol/api/schema-types'
import {
  kindLabel,
  laneCell,
  RESULT_TONE,
  resultText,
  resultTone,
} from '../../src/lib/matches/games-view.ts'

/**
 * The rules the game log still needs (match-history.md §9).
 *
 * The scope selector, the `3/5` counts and the per-game grouping were removed with the games page
 * they belonged to; these are the four decisions the log and its lane cells are built on.
 */

describe('kindLabel', () => {
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

describe('resultText', () => {
  test('S and N, and a dash when nobody recorded a result', () => {
    expect(resultText(true)).toBe('S')
    expect(resultText(false)).toBe('N')
    expect(resultText(null)).toBe('–')
  })
})

describe('resultTone', () => {
  test('the colours are theme tokens, not Mantine colour names', () => {
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
