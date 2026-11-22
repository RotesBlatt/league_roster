/**
 * Availability arithmetic — the pure core of the week planner (availability-planner.md §6).
 *
 * No DB, no React, no HTTP: everything here takes plain arrays and returns plain arrays, so the
 * hardest part of the feature can be tested without infrastructure.
 *
 * Times are **minutes from midnight** on the team's wall clock, and every interval is half-open
 * `[start, end)` with `end = 1440` meaning "until midnight".
 */

/** One free stretch on one day. `end` is exclusive, so `end - start` is the true duration. */
export type Interval = { start: number; end: number }

/** A member's free stretch. The userId is what makes "distinct people" computable. */
export type PersonInterval = Interval & { userId: string }

/** Minutes over which the care of a day is reported. */
export type CoverageSegment = {
  start: number
  end: number
  /** Everyone free for the whole segment, sorted — a set, so one person can never count twice. */
  users: string[]
  count: number
}

/** A candidate session: playable for its whole length, with the people who can actually make it. */
export type PlayWindow = {
  start: number
  end: number
  /** Guaranteed available for the whole window: the intersection, not the best minute. */
  users: string[]
  count: number
  /** Roster members who cannot make the whole window — a list of names, not a number. */
  missing: string[]
}

/** Status quo: 4 available (substitute included) is playable. Below that a slot is not shown. */
export const MIN_PLAYABLE = 4
/** A candidate shorter than an hour is not worth a session. */
export const MIN_SESSION_MINUTES = 60
/** Minutes in a day; "until midnight" is this, never 0. */
export const DAY_MINUTES = 1440

/**
 * Normalises one day for one owner: sorted by start, overlapping and adjacent stretches merged.
 * Adjacency counts (`9-12` + `12-15` → `9-15`) because a gap of zero minutes is no gap.
 *
 * The input is left untouched — callers hand in rows they still need.
 */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: Interval[] = []

  for (const interval of sorted) {
    const last = merged.at(-1)
    if (last && interval.start <= last.end) {
      if (interval.end > last.end) last.end = interval.end
      continue
    }
    merged.push({ start: interval.start, end: interval.end })
  }

  return merged
}

/** Each person's day normalised separately — the reason one person can never count twice. */
function mergePerUser(intervals: readonly PersonInterval[]): PersonInterval[] {
  const byUser = new Map<string, Interval[]>()

  for (const { userId, start, end } of intervals) {
    const own = byUser.get(userId)
    if (own) own.push({ start, end })
    else byUser.set(userId, [{ start, end }])
  }

  return [...byUser].flatMap(([userId, own]) =>
    mergeIntervals(own).map((interval) => ({ userId, ...interval })),
  )
}

const sameUsers = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((user, index) => user === b[index])

/**
 * How many distinct people are free at every minute of the day (§6 steps 1–3).
 *
 * Boundaries come from the intervals themselves, so the output is exact and as small as the data
 * allows. Neighbouring segments are merged **only when the same people are free on both sides**:
 * merging on the count alone would let `9-12: a` and `12-15: b` become one segment claiming both
 * are free all afternoon, which then lies in `missing`.
 */
export function computeCoverage(intervals: readonly PersonInterval[]): CoverageSegment[] {
  const normalised = mergePerUser(intervals)
  const boundaries = [...new Set(normalised.flatMap(({ start, end }) => [start, end]))].sort(
    (a, b) => a - b,
  )

  const segments: CoverageSegment[] = []

  for (let index = 1; index < boundaries.length; index++) {
    const start = boundaries[index - 1]
    const end = boundaries[index]
    if (start === undefined || end === undefined || end <= start) continue

    const users = [
      ...new Set(
        normalised
          .filter((interval) => interval.start <= start && interval.end >= end)
          .map((interval) => interval.userId),
      ),
    ].sort()
    if (users.length === 0) continue

    const last = segments.at(-1)
    if (last && last.end === start && sameUsers(last.users, users)) {
      last.end = end
      continue
    }

    segments.push({ start, end, users, count: users.length })
  }

  return segments
}

/**
 * Turns coverage into the sessions worth offering (§6 steps 4–5).
 *
 * A run of playable coverage becomes **one** window whose people are those free for the *whole*
 * run — so the count never overstates a single good minute. If the running intersection would drop
 * below `minPlayable`, the run is split instead of lying. Runs shorter than `minSession` are
 * dropped, never shortened.
 *
 * `roster` is required: "playable" is a statement about the team, and an empty roster must mean
 * "nothing offered", not "everyone is free".
 */
export function findPlayWindows(
  coverage: readonly CoverageSegment[],
  opts: {
    roster: readonly string[]
    minPlayable?: number
    minSession?: number
  },
): PlayWindow[] {
  const { roster, minPlayable = MIN_PLAYABLE, minSession = MIN_SESSION_MINUTES } = opts

  const windows: PlayWindow[] = []
  let run: { start: number; end: number; users: string[] } | null = null

  const close = () => {
    if (!run) return
    if (run.end - run.start >= minSession) {
      windows.push({
        start: run.start,
        end: run.end,
        users: run.users,
        count: run.users.length,
        missing: roster.filter((user) => !run?.users.includes(user)).sort(),
      })
    }
    run = null
  }

  for (const segment of coverage) {
    if (run && run.end !== segment.start) close()

    const available = segment.users.filter((user) => roster.includes(user))
    if (available.length < minPlayable) {
      close()
      continue
    }

    if (!run) {
      run = { start: segment.start, end: segment.end, users: available }
      continue
    }

    const together = run.users.filter((user) => available.includes(user))
    if (together.length >= minPlayable) {
      run.users = together
      run.end = segment.end
      continue
    }

    close()
    run = { start: segment.start, end: segment.end, users: available }
  }

  close()

  return windows.sort(
    (a, b) => b.count - a.count || b.end - b.start - (a.end - a.start) || a.start - b.start,
  )
}
