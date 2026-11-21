/**
 * The rate budget is the real constraint (riot-api.md §4): a development key allows ~100 requests
 * per 2 minutes for the whole server, and one check is three calls. This is a **comfort feature**,
 * not a security boundary — it exists so one person holding down "Check" cannot spend the team's
 * budget, and it is in-process because one API instance sharing a key is the deployment we have.
 *
 * The clock is injected so the window is testable without a `sleep`.
 */

/** 10 checks a minute is 30 Riot requests — a third of the shared two-minute budget, at most. */
export const LOOKUP_LIMIT = 10

export const LOOKUP_WINDOW_MS = 60_000

export type ThrottleDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number }

export type ThrottleOptions = {
  /** Checks allowed per user per window. */
  limit?: number
  windowMs?: number
  now?: () => number
}

export type Throttle = {
  /** Records an attempt and answers whether it may proceed. */
  take(userId: string): ThrottleDecision
  /** Users currently tracked; the map must not grow with the roster forever. */
  readonly size: number
}

export function createThrottle({
  limit = LOOKUP_LIMIT,
  windowMs = LOOKUP_WINDOW_MS,
  now = Date.now,
}: ThrottleOptions = {}): Throttle {
  /** Per user, the timestamps still inside the window, oldest first. */
  const hits = new Map<string, number[]>()

  /** Drops expired stamps *and* users whose window is empty — one pass per attempt, tiny. */
  function prune(at: number): void {
    for (const [userId, stamps] of hits) {
      const fresh = stamps.filter((stamp) => at - stamp < windowMs)
      if (fresh.length === 0) hits.delete(userId)
      else if (fresh.length !== stamps.length) hits.set(userId, fresh)
    }
  }

  return {
    take(userId) {
      const at = now()
      prune(at)

      const stamps = hits.get(userId) ?? []
      const oldest = stamps[0]

      if (oldest !== undefined && stamps.length >= limit) {
        // seconds until the oldest attempt leaves the window, never 0: "try again in a moment"
        const seconds = Math.ceil((oldest + windowMs - at) / 1000)
        return { allowed: false, retryAfterSeconds: Math.max(1, seconds) }
      }

      hits.set(userId, [...stamps, at])
      return { allowed: true }
    },

    get size() {
      return hits.size
    },
  }
}
