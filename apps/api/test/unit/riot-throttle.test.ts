import { describe, expect, test } from 'bun:test'
import { createThrottle, LOOKUP_LIMIT, LOOKUP_WINDOW_MS } from '../../src/riot/throttle.ts'

/**
 * Comfort, not security (riot-api.md §4): one person pressing "Check" in a loop must not spend the
 * budget the whole team shares (100 requests / 2 min, three calls per check). In-process is enough
 * for one API instance, and the clock is injected so the window is testable without waiting.
 */

const at = (times: number[]) => {
  let index = 0
  return () => times[Math.min(index++, times.length - 1)] ?? 0
}

describe('createThrottle', () => {
  test('the defaults are the documented budget: 10 lookups per minute', () => {
    expect(LOOKUP_LIMIT).toBe(10)
    expect(LOOKUP_WINDOW_MS).toBe(60_000)
  })

  test('up to the limit is allowed, the one after it is not', () => {
    const throttle = createThrottle({ limit: 3, windowMs: 60_000, now: () => 0 })

    expect(throttle.take('alice')).toEqual({ allowed: true })
    expect(throttle.take('alice')).toEqual({ allowed: true })
    expect(throttle.take('alice')).toEqual({ allowed: true })
    expect(throttle.take('alice')).toEqual({ allowed: false, retryAfterSeconds: 60 })
  })

  test('the throttle is per user — one person’s loop does not lock the team out', () => {
    const throttle = createThrottle({ limit: 1, windowMs: 60_000, now: () => 0 })

    expect(throttle.take('alice')).toEqual({ allowed: true })
    expect(throttle.take('alice')).toEqual({ allowed: false, retryAfterSeconds: 60 })
    expect(throttle.take('bob')).toEqual({ allowed: true })
  })

  test('the window slides: after it has passed, the same user is allowed again', () => {
    const now = at([0, 1_000, 60_000])
    const throttle = createThrottle({ limit: 1, windowMs: 60_000, now })

    expect(throttle.take('alice')).toEqual({ allowed: true }) // t=0
    expect(throttle.take('alice')).toEqual({ allowed: false, retryAfterSeconds: 59 }) // t=1s
    expect(throttle.take('alice')).toEqual({ allowed: true }) // t=60s
  })

  test('Retry-After counts down and never says zero', () => {
    const now = at([0, 59_000, 59_999])
    const throttle = createThrottle({ limit: 1, windowMs: 60_000, now })

    throttle.take('alice')
    expect(throttle.take('alice')).toEqual({ allowed: false, retryAfterSeconds: 1 })
    expect(throttle.take('alice')).toEqual({ allowed: false, retryAfterSeconds: 1 })
  })

  test('users outside the window are forgotten, so memory does not grow with the roster', () => {
    const now = at([0, 0, 120_000, 120_000])
    const throttle = createThrottle({ limit: 1, windowMs: 60_000, now })

    throttle.take('alice')
    throttle.take('bob')
    expect(throttle.size).toBe(2)

    throttle.take('carol') // two windows later: alice and bob are pruned
    expect(throttle.size).toBe(1)
  })
})
