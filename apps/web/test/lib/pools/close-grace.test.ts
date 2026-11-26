import { describe, expect, test } from 'bun:test'
import { CLOSE_GRACE_MS, createCloseGrace, type Timer } from '../../../src/lib/pools/close-grace.ts'

/**
 * The chip menu's closing delay (champion-pools.md §7).
 *
 * Leaving the panel used to close it instantly, so moving the pointer to a menu item — or just
 * twitching — made the menu disappear under the cursor. Now leaving only *schedules* the close and
 * coming back cancels it. The whole value is in the edge cases (re-enter cancels, an immediate close
 * cancels the pending timer, two leaves queue one close), and they are only reliably provable with a
 * clock we control instead of a 200 ms sleep.
 */

/** A timer stand-in: nothing runs until the test says so. */
function fakeTimers() {
  let nextId = 1
  const queued = new Map<number, () => void>()

  const timers: Timer = {
    set: (run) => {
      const id = nextId++
      queued.set(id, run)
      return id
    },
    clear: (id) => {
      queued.delete(id as number)
    },
  }

  return {
    timers,
    pending: () => queued.size,
    runAll: () => {
      const running = [...queued.entries()]
      queued.clear()
      for (const [, run] of running) run()
    },
  }
}

describe('createCloseGrace', () => {
  test('the default window is 0.2 s', () => {
    expect(CLOSE_GRACE_MS).toBe(200)
  })

  test('leaving schedules the close, it does not close on the spot', () => {
    const clock = fakeTimers()
    let closed = 0
    const grace = createCloseGrace(() => closed++, { timers: clock.timers })

    grace.schedule()
    expect(closed).toBe(0)
    expect(grace.isPending()).toBe(true)

    clock.runAll()
    expect(closed).toBe(1)
    expect(grace.isPending()).toBe(false)
  })

  test('coming back cancels the pending close — that is the whole point', () => {
    const clock = fakeTimers()
    let closed = 0
    const grace = createCloseGrace(() => closed++, { timers: clock.timers })

    grace.schedule()
    grace.cancel()
    clock.runAll()

    expect(closed).toBe(0)
    expect(clock.pending()).toBe(0)
  })

  test('leaving twice queues one close, not two', () => {
    const clock = fakeTimers()
    let closed = 0
    const grace = createCloseGrace(() => closed++, { timers: clock.timers })

    grace.schedule()
    grace.schedule()
    expect(clock.pending()).toBe(1)

    clock.runAll()
    expect(closed).toBe(1)
  })

  test('an immediate close drops the pending timer, so it cannot fire on a closed menu', () => {
    const clock = fakeTimers()
    let closed = 0
    const grace = createCloseGrace(() => closed++, { timers: clock.timers })

    grace.schedule()
    grace.closeNow()
    expect(closed).toBe(1)

    clock.runAll()
    // still one: Escape or an outside click already did the job
    expect(closed).toBe(1)
    expect(clock.pending()).toBe(0)
  })

  test('the delay is the one it was given, and each schedule re-arms it', () => {
    const requested: number[] = []
    const timers: Timer = {
      set: (_run, ms) => {
        requested.push(ms)
        return requested.length
      },
      clear: () => {},
    }

    const grace = createCloseGrace(() => {}, { delay: 500, timers })
    grace.schedule()
    grace.schedule()

    expect(requested).toEqual([500, 500])
  })

  test('closing with nothing pending is still one close call — callers need no null check', () => {
    const clock = fakeTimers()
    let closed = 0
    const grace = createCloseGrace(() => closed++, { timers: clock.timers })

    grace.closeNow()
    expect(closed).toBe(1)
  })
})
