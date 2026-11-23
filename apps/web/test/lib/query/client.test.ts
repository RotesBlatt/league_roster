import { describe, expect, test } from 'bun:test'
import { createQueryClient } from '../../../src/lib/query/client.ts'

/**
 * The app's React Query defaults are behaviour, not configuration noise: they decide whether a
 * member who comes back from Discord sees last season's roster or this minute's. They live in a
 * plain module (`src/lib/query/client.ts`) precisely so this file can assert them without mounting
 * a component — the same rule the rest of `lib/` follows.
 */

describe('the app query client', () => {
  test('refetches when the window regains focus', () => {
    // The whole point of the flag: a tab left open during a draft is stale by definition, and
    // coming back to it is the cheapest "reactive" there is (realtime.md §3).
    expect(createQueryClient().getDefaultOptions().queries?.refetchOnWindowFocus).toBe(true)
  })

  test('retries a failed request once, not three times', () => {
    // The default of 3 turns one flaky request into four round trips before the error is shown.
    expect(createQueryClient().getDefaultOptions().queries?.retry).toBe(1)
  })

  test('every client starts from those defaults, not from React Query’s', () => {
    const defaults = createQueryClient().getDefaultOptions()

    expect(defaults.queries?.refetchOnWindowFocus).not.toBeUndefined()
    expect(defaults.queries?.retry).not.toBeUndefined()
  })
})
