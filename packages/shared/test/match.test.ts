import { describe, expect, test } from 'bun:test'
import { MATCH_KINDS, MATCH_SIDES, MATCH_SOURCES, TAGGABLE_KINDS } from '../src/match.ts'

/**
 * The match vocabulary (match-history.md §5, §6). It is exported from `@lol/shared` because the DB
 * CHECKs in `apps/api/src/db/schema.ts` are generated from these arrays (quick-wins.md D1): if the
 * two disagreed, Postgres would reject a value the application writes. So the assertions here are
 * about *shape* — the values themselves are Riot's or the product's, and are pinned where used.
 */

describe('MATCH_SOURCES', () => {
  test('exactly the two writers into `match`, and no third', () => {
    // §5.9: a tournament game is a Riot row plus a membership link, not a third source.
    expect([...MATCH_SOURCES]).toEqual(['riot', 'manual'])
  })

  test('values are unique and non-empty', () => {
    expect(new Set(MATCH_SOURCES).size).toBe(MATCH_SOURCES.length)
    expect(MATCH_SOURCES.length).toBeGreaterThan(0)
  })
})

describe('MATCH_SIDES', () => {
  test("Riot's two side numbers, not 0/1 and not 'blue'/'red'", () => {
    expect([...MATCH_SIDES]).toEqual([100, 200])
  })
})

describe('TAGGABLE_KINDS', () => {
  test('a human may re-tag a game as tournament, scrim or custom — nothing else', () => {
    // §6: SoloQ/Flex are Riot facts (queueId) and must not be re-taggable by hand, and
    // 'other'/'normal' are a fallback, not a decision somebody makes.
    expect([...TAGGABLE_KINDS]).toEqual(['tournament', 'scrim', 'custom'])
  })

  test('every taggable kind is also a resolved kind', () => {
    for (const kind of TAGGABLE_KINDS) expect(MATCH_KINDS).toContain(kind)
  })
})

describe('MATCH_KINDS', () => {
  test('the resolved kinds of one game, derived or tagged', () => {
    expect([...MATCH_KINDS]).toEqual([
      'solo',
      'flex',
      'normal',
      'custom',
      'tournament',
      'scrim',
      'other',
    ])
  })

  test('values are unique — the column CHECK cannot be ambiguous', () => {
    expect(new Set(MATCH_KINDS).size).toBe(MATCH_KINDS.length)
  })

  test('no kind is derived from a side or a source: those are separate vocabularies', () => {
    for (const kind of MATCH_KINDS) expect(MATCH_SOURCES).not.toContain(kind)
  })
})
