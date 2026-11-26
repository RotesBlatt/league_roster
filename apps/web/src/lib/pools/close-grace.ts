/**
 * The chip menu's closing delay (champion-pools.md §7).
 *
 * Leaving the panel used to close it instantly, which reads as "the menu ran away": moving the
 * pointer onto an item, or a small twitch, dismissed it. Leaving now only *schedules* the close, and
 * coming back within the window cancels it — the standard grace-period behaviour of a hover menu.
 *
 * Kept out of the component for one reason: the interesting cases are timing edges (re-enter cancels,
 * an immediate close cancels the pending timer, two leaves queue one close), and those are only
 * provable deterministically with an injectable clock. `ChipActions` supplies the real one.
 */

/** How long the panel stays open after the pointer leaves it. Short enough not to feel stuck. */
export const CLOSE_GRACE_MS = 200

/** The two clock calls this module needs, so a test can supply a fake one. */
export type Timer = {
  set: (run: () => void, ms: number) => unknown
  clear: (id: unknown) => void
}

const systemTimers: Timer = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
}

export type CloseGrace = {
  /** The pointer left: close after the grace window unless something cancels it. */
  schedule: () => void
  /** The pointer came back (or the menu moved): drop the pending close. */
  cancel: () => void
  /** Escape, an outside click, a scroll, a chosen action: close now, and drop the pending timer. */
  closeNow: () => void
  /** Is a close waiting on the clock? Exposed for tests; the component does not need it. */
  isPending: () => boolean
}

/**
 * A repeatable "close soon" with cancellation. Every `schedule` replaces the pending timer rather
 * than adding one, so a pointer that leaves three times does not close the menu three times — the
 * second call would hit a menu that is already gone.
 */
export function createCloseGrace(
  onClose: () => void,
  options: { delay?: number; timers?: Timer } = {},
): CloseGrace {
  const delay = options.delay ?? CLOSE_GRACE_MS
  const timers = options.timers ?? systemTimers
  let pending: unknown = null

  const cancel = () => {
    if (pending === null) return
    timers.clear(pending)
    pending = null
  }

  return {
    schedule() {
      cancel()
      pending = timers.set(() => {
        pending = null
        onClose()
      }, delay)
    },
    cancel,
    closeNow() {
      // cancelling first is the point: a timer firing after an Escape would call onClose on an
      // already-closed panel, which is harmless today only because the parent ignores repeats
      cancel()
      onClose()
    },
    isPending: () => pending !== null,
  }
}
