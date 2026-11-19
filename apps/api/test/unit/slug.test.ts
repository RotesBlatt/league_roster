import { describe, expect, test } from 'bun:test'
import { SLUG_MAX, slugify, slugProblem } from '../../src/lib/slug.ts'

/**
 * The slug is derived, never typed: a team name is what a captain chooses, the URL
 * segment falls out of it (multi-team.md §7.2 — decided while implementing).
 */
describe('slugify', () => {
  test('lowercases and joins words with a hyphen', () => {
    expect(slugify('Die Besten')).toBe('die-besten')
  })

  test('transliterates German umlauts the way a German URL would', () => {
    expect(slugify('Die Löwen')).toBe('die-loewen')
    expect(slugify('Straße 5')).toBe('strasse-5')
    // German letters are spelled out wherever they appear, not folded to the base vowel
    expect(slugify('Grüße aus München')).toBe('gruesse-aus-muenchen')
  })

  test('folds accents that have no German spelling into their base letter', () => {
    expect(slugify('Café Ñandú')).toBe('cafe-nandu')
  })

  test('collapses punctuation, spaces and stray hyphens into single hyphens', () => {
    expect(slugify('  --A   B!! -- ')).toBe('a-b')
  })

  test('keeps digits', () => {
    expect(slugify('Team 2k25')).toBe('team-2k25')
  })

  test('a name of only symbols leaves nothing to use', () => {
    expect(slugify('!!!')).toBe('')
  })

  test('truncates a long name to the limit without a trailing hyphen', () => {
    const slug = slugify('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bb')
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX)
    expect(slug.endsWith('-')).toBe(false)
  })
})

describe('slugProblem', () => {
  test('accepts a plain slug', () => {
    expect(slugProblem('die-besten')).toBeNull()
  })

  test('rejects one that is too short to be a URL', () => {
    expect(slugProblem('ab')).not.toBeNull()
    expect(slugProblem('')).not.toBeNull()
  })

  test('rejects one that is too long', () => {
    expect(slugProblem('a'.repeat(SLUG_MAX + 1))).not.toBeNull()
  })

  // a slug that doubles as our own route prefix would shadow it
  test('rejects reserved words', () => {
    expect(slugProblem('api')).not.toBeNull()
    expect(slugProblem('admin')).not.toBeNull()
    expect(slugProblem('login')).not.toBeNull()
    expect(slugProblem('join')).not.toBeNull()
    expect(slugProblem('t')).not.toBeNull()
    expect(slugProblem('default')).not.toBeNull()
  })
})
