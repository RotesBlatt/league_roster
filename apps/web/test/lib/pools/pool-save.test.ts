import { describe, expect, test } from 'bun:test'
import { ApiError } from '../../../src/api/result.ts'
import { saveFailure } from '../../../src/lib/pools/pool-save.ts'

/**
 * What the page decides around a save (champion-pools.md §5).
 *
 * The important one is the stale `409`: it is the difference between "your rearrangement was sent
 * and lost" and "somebody saved from another tab, here is the current version". That decision is a
 * pure function so it cannot rot inside a component, and so the wording is testable.
 */

describe('saveFailure', () => {
  test('a stale version reloads instead of retrying, and says so without blaming the user', () => {
    const failure = saveFailure(new ApiError(409, 'stale'))
    expect(failure.reload).toBe(true)
    expect(failure.color).toBe('yellow')
    expect(failure.message).toMatch(/another tab/i)
  })

  test('a 422 shows the server’s rule, because only it knows which rule was broken', () => {
    const failure = saveFailure(new ApiError(422, 'Champion 1 is in main twice'))
    expect(failure.reload).toBe(false)
    expect(failure.color).toBe('red')
    expect(failure.message).toBe('Champion 1 is in main twice')
  })

  test('anything else is an ordinary failure and the draft is kept', () => {
    const failure = saveFailure(new ApiError(500, 'Internal error'))
    expect(failure.reload).toBe(false)
    expect(failure.message).toBe('Internal error')
  })

  test('a non-API error still produces a sentence', () => {
    expect(saveFailure(new Error('')).message.length).toBeGreaterThan(0)
  })
})
