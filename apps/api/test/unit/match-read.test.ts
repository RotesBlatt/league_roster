import { describe, expect, test } from 'bun:test'
import {
  decodeCursor,
  encodeCursor,
  GAMES_PAGE_DEFAULT,
  GAMES_PAGE_MAX,
  parseGamesQuery,
} from '../../src/lib/match-read.ts'

/**
 * The two pure pieces of the games read: the cursor and the query string.
 *
 * **Honest note:** these two functions were written with the read model, before these tests — the
 * test-first cases for this patch are the route's tenancy and scope behaviour (the integration
 * suite), because that is where the risk is. What follows pins the edges that a route test cannot
 * reach cheaply: a cursor from another release, a limit of zero, a scope nobody implements.
 */

describe('the cursor', () => {
  const match = { id: 'm-1', gameStartAt: new Date('2026-11-01T18:00:00.000Z') }

  test('round-trips a match unchanged', () => {
    const decoded = decodeCursor(encodeCursor(match))
    expect(decoded?.id).toBe('m-1')
    expect(decoded?.gameStartAt.toISOString()).toBe('2026-11-01T18:00:00.000Z')
  })

  test('the id is the tie-breaker, so two games in the same second stay distinguishable', () => {
    const at = new Date('2026-11-01T18:00:00.000Z')
    const first = encodeCursor({ id: 'a', gameStartAt: at })
    const second = encodeCursor({ id: 'b', gameStartAt: at })
    expect(first).not.toBe(second)
    expect(decodeCursor(first)?.id).toBe('a')
    expect(decodeCursor(second)?.id).toBe('b')
  })

  test('a manual match id works too — the cursor does not need a Riot id', () => {
    const manual = encodeCursor({ id: 'f47ac10b-58cc', gameStartAt: new Date() })
    expect(decodeCursor(manual)?.id).toBe('f47ac10b-58cc')
  })

  test('junk is "start over", not a 500', () => {
    // every one of these is a client bug or an old release's cursor; none may crash the route
    expect(decodeCursor(null)).toBeNull()
    expect(decodeCursor(undefined)).toBeNull()
    expect(decodeCursor('')).toBeNull()
    expect(decodeCursor('no-separator')).toBeNull()
    expect(decodeCursor('not-a-date|m-1')).toBeNull()
    expect(decodeCursor('2026-11-01T18:00:00.000Z|')).toBeNull()
    expect(decodeCursor('|m-1')).toBeNull()
  })

  test('a pipe inside a future id would not break the split', () => {
    // the last separator wins, so the id may one day contain anything
    const decoded = decodeCursor('2026-11-01T18:00:00.000Z|weird|id')
    expect(decoded?.id).toBe('weird|id')
  })
})

describe('parseGamesQuery', () => {
  test('an empty query is "all", one page', () => {
    expect(parseGamesQuery({})).toEqual({
      ok: true,
      value: { scope: 'all', cursor: null, limit: GAMES_PAGE_DEFAULT, player: null },
    })
  })

  test('a known scope is accepted, including the new one', () => {
    for (const scope of ['all', 'solo', 'flex', 'ranked5', 'scrim', 'tournament', 'custom']) {
      const parsed = parseGamesQuery({ scope })
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(parsed.value.scope).toBe(scope as never)
    }
  })

  test('an unknown scope is refused instead of falling back to "all"', () => {
    // falling back would render every kind under the label the user picked
    const parsed = parseGamesQuery({ scope: 'aram' })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.message).toContain('aram')
  })

  test('a limit over the cap is clamped, not refused', () => {
    const parsed = parseGamesQuery({ limit: '5000' })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.limit).toBe(GAMES_PAGE_MAX)
  })

  test('a limit of 0, a negative one or a fraction is refused', () => {
    for (const limit of ['0', '-3', '1.5', 'lots']) {
      expect(parseGamesQuery({ limit }).ok).toBe(false)
    }
  })

  test('a player filter is passed through, and an empty one means everybody', () => {
    const mine = parseGamesQuery({ player: ' u1 ' })
    expect(mine.ok).toBe(true)
    if (mine.ok) expect(mine.value.player).toBe('u1')

    // `?player=` (the form serialising an empty select) must not become "the person with no id"
    const everyone = parseGamesQuery({ player: '   ' })
    expect(everyone.ok).toBe(true)
    if (everyone.ok) expect(everyone.value.player).toBeNull()
  })

  test('an empty cursor is no cursor', () => {
    const parsed = parseGamesQuery({ cursor: '   ' })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.cursor).toBeNull()
  })

  test('whitespace around a real scope does not make it unknown', () => {
    const parsed = parseGamesQuery({ scope: ' flex ' })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.scope).toBe('flex')
  })
})
