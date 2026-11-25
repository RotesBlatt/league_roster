import { describe, expect, test } from 'bun:test'
import { createSaveQueue } from '../../../src/lib/pools/save-queue.ts'

/**
 * The autosave queue (champion-pools.md §5).
 *
 * This is the only place the "no two writes race" promise can be proven: in a browser it shows up as
 * an occasional `409` against your own previous save, which is unreproducible by hand. Each test
 * drives the queue with a controllable promise, so "in flight" and "queued" are real states.
 */

type Sent = { version: number; lists: { main: number[]; situational: number[]; blind: number[] } }

const lists = (main: number[]) => ({ main, situational: [], blind: [] })

/** A `send` whose promises resolve only when the test says so. */
function controllable(bump = 1) {
  const sent: Sent[] = []
  const pending: { resolve: (version: number) => void; reject: (error: unknown) => void }[] = []

  const send = (input: Sent) => {
    sent.push(input)
    return new Promise<{ version: number }>((resolve, reject) => {
      pending.push({
        resolve: () => resolve({ version: input.version + bump }),
        reject,
      })
    })
  }

  return {
    sent,
    send,
    resolveNext() {
      pending.shift()?.resolve(1)
    },
    rejectNext(error: unknown) {
      pending.shift()?.reject(error)
    },
    pendingCount: () => pending.length,
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createSaveQueue', () => {
  test('a single edit is sent immediately with the version it was given', async () => {
    const wire = controllable()
    const queue = createSaveQueue({ send: wire.send, onFailure: () => {}, version: 3 })

    queue.push(lists([1]))
    await flush()

    expect(wire.sent).toEqual([{ version: 3, lists: lists([1]) }])
  })

  test('edits made while a write is in flight are coalesced into one follow-up', async () => {
    const wire = controllable()
    const queue = createSaveQueue({ send: wire.send, onFailure: () => {}, version: 3 })

    queue.push(lists([1]))
    await flush()
    expect(wire.sent).toHaveLength(1)

    // two more gestures while the first write is still open: only the last state matters
    queue.push(lists([2]))
    queue.push(lists([3]))
    expect(wire.sent).toHaveLength(1)

    wire.resolveNext()
    await flush()
    expect(wire.sent).toHaveLength(2)
    expect(wire.sent[1]?.lists).toEqual(lists([3]))
  })

  test('the follow-up uses the version the previous write returned', async () => {
    const wire = controllable() // each response bumps by 1
    const queue = createSaveQueue({ send: wire.send, onFailure: () => {}, version: 3 })

    queue.push(lists([1]))
    await flush()
    queue.push(lists([2]))
    wire.resolveNext() // first write returns 4
    await flush()

    expect(wire.sent[1]?.version).toBe(4)
  })

  test('a read during a write cannot move the version the next write uses', async () => {
    const wire = controllable()
    const queue = createSaveQueue({ send: wire.send, onFailure: () => {}, version: 3 })

    queue.push(lists([1]))
    await flush()
    queue.push(lists([2]))
    // the page refetches and still says 3 (the write has not landed yet)
    queue.setVersion(3)
    wire.resolveNext()
    await flush()

    expect(wire.sent[1]?.version).toBe(4)

    // let the chain finish, then a read is authoritative again for the next write
    wire.resolveNext()
    await flush()
    queue.setVersion(9)
    queue.push(lists([3]))
    await flush()
    expect(wire.sent[2]?.version).toBe(9)
  })

  test('a failure stops the chain and reports once — no retry loop', async () => {
    const wire = controllable()
    const failures: unknown[] = []
    const queue = createSaveQueue({
      send: wire.send,
      onFailure: (error) => failures.push(error),
      version: 3,
    })

    queue.push(lists([1]))
    await flush()
    queue.push(lists([2]))
    wire.rejectNext(new Error('stale'))
    await flush()

    expect(failures).toHaveLength(1)
    // the queued edit is dropped: it was built on a pool that no longer exists
    expect(wire.sent).toHaveLength(1)
    expect(queue.idle()).toBe(true)
  })

  test('saving state is reported around the whole chain, not per request', async () => {
    const wire = controllable()
    const states: boolean[] = []
    const queue = createSaveQueue({
      send: wire.send,
      onFailure: () => {},
      onSavingChange: (saving) => states.push(saving),
      version: 3,
    })

    queue.push(lists([1]))
    await flush()
    queue.push(lists([2]))
    wire.resolveNext()
    await flush()
    expect(states).toEqual([true])

    wire.resolveNext()
    await flush()
    expect(states).toEqual([true, false])
  })
})
