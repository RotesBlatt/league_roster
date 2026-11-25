import type { PoolLists } from '@lol/shared'

/**
 * The autosave queue (champion-pools.md §5): writes pool edits one at a time.
 *
 * Autosave means two gestures can overlap — a reorder sent at version 7 is still in flight while the
 * next one is made. Firing a `PUT` per gesture would make the second a `409` against our own first
 * write, so:
 *
 * - **one request at a time**, in the order edits happened;
 * - while one runs, newer edits **replace** the single queued payload — nobody wants the
 *   intermediate states, only the last one;
 * - each request uses the version the previous one returned, never the version the page loaded with;
 * - the first failure **stops** the chain and hands the error over: retrying a rejected write would
 *   be a loop, and continuing would send edits built on a pool that does not exist any more.
 *
 * No React here on purpose: this is the part that must be provably race-free, and a hook is not a
 * place to prove anything.
 */
export type SaveQueue = {
  /** Accept the newest pool. Sends immediately when idle, otherwise replaces what is queued. */
  push: (lists: PoolLists) => void
  /** The version a write may use. Updated from reads, and by every successful write. */
  setVersion: (version: number) => void
  /** No request running and nothing queued. */
  idle: () => boolean
}

export function createSaveQueue(opts: {
  send: (input: { version: number; lists: PoolLists }) => Promise<{ version: number }>
  onFailure: (error: unknown) => void
  onSavingChange?: (saving: boolean) => void
  /** The version at boot: whatever the page last read. */
  version: number
}): SaveQueue {
  let queued: PoolLists | null = null
  let running = false
  let version = opts.version

  const drain = async () => {
    if (running) return
    running = true
    opts.onSavingChange?.(true)

    try {
      for (;;) {
        const next = queued
        if (!next) break
        queued = null

        try {
          // a newer edit may arrive while this is in flight: it lands in `queued`, and the loop
          // sends it next with the version this response returned
          const result = await opts.send({ version, lists: next })
          version = result.version
        } catch (error) {
          queued = null
          opts.onFailure(error)
          break
        }
      }
    } finally {
      running = false
      opts.onSavingChange?.(false)
    }
  }

  return {
    push(lists) {
      queued = lists
      void drain()
    },
    setVersion(next) {
      // a read while a write is in flight must not move the version backwards or forwards: the
      // response of that write is the authority for the next one
      if (!running) version = next
    },
    idle: () => !running && queued === null,
  }
}
