import { mergeIntervals } from '@lol/shared'
import { addDays } from './week.ts'

/**
 * What a week write is allowed to contain, decided before anything touches the database
 * (availability-planner.md §4, §9.1).
 *
 * Two rules are load-bearing:
 *   - times snap to the grid's half hours. The grid is a UI decision, so it must not become a
 *     migration — but a client that is not the grid still cannot store 20-minute slivers;
 *   - intervals are normalised per day *here*, so one person can never appear twice at the same
 *     minute and the aggregation (§6) never has to dedupe.
 *
 * A bad interval fails the whole write instead of being dropped: a partially saved week is worse
 * than a rejected one, because nobody can tell what happened.
 */

/** One cell of the painted grid. The only granularity the input side knows. */
export const SLOT_MINUTES = 30
/** Minutes in a day; "until midnight" is this, never 0. */
export const DAY_MINUTES = 1440
/** Weeks the window shows: this one and the next. */
export const VISIBLE_WEEKS = 2
/** Days in a week, Monday first. */
export const DAYS_PER_WEEK = 7

export type DayWrite = {
  dayOfWeek: number
  intervals: { start: number; end: number }[]
}

/** One row of `availability`, ready to insert. */
export type AvailabilityWrite = {
  dayOfWeek: number
  startMinute: number
  endMinute: number
}

export type WriteProblem = { field: string; message: string }

const onSlot = (minute: number) => Number.isInteger(minute) && minute % SLOT_MINUTES === 0

/** The first rule this interval breaks, or null. One problem per interval, never a pile. */
function intervalProblem(
  interval: { start: number; end: number },
  field: string,
): WriteProblem | null {
  const { start, end } = interval

  if (!onSlot(start)) {
    return { field: `${field}.start`, message: 'Times must sit on a 30-minute boundary' }
  }
  if (!onSlot(end)) {
    return { field: `${field}.end`, message: 'Times must sit on a 30-minute boundary' }
  }
  if (start < 0 || start >= DAY_MINUTES) {
    return { field: `${field}.start`, message: 'Times must be inside the day' }
  }
  if (end > DAY_MINUTES) {
    return { field: `${field}.end`, message: 'Times must be inside the day' }
  }
  if (end <= start) {
    return { field: `${field}.end`, message: 'The end must be after the start' }
  }

  return null
}

/**
 * Body in, rows out. An empty result with no problems is a valid answer — "I am free nowhere this
 * week" is a statement, and it is what makes the `answer` row worth its own table (§4).
 */
export function normalizeWeekWrite(days: readonly DayWrite[]): {
  rows: AvailabilityWrite[]
  problems: WriteProblem[]
} {
  const problems: WriteProblem[] = []
  const byDay = new Map<number, { start: number; end: number }[]>()

  days.forEach((entry, dayIndex) => {
    const where = `days[${dayIndex}]`

    if (
      !Number.isInteger(entry.dayOfWeek) ||
      entry.dayOfWeek < 0 ||
      entry.dayOfWeek >= DAYS_PER_WEEK
    ) {
      problems.push({
        field: `${where}.dayOfWeek`,
        message: 'A weekday must be 0 (Monday) to 6 (Sunday)',
      })
      return
    }

    entry.intervals.forEach((interval, intervalIndex) => {
      const problem = intervalProblem(interval, `${where}.intervals[${intervalIndex}]`)
      if (problem) {
        problems.push(problem)
        return
      }

      const own = byDay.get(entry.dayOfWeek) ?? []
      own.push({ start: interval.start, end: interval.end })
      byDay.set(entry.dayOfWeek, own)
    })
  })

  // Nothing is written when anything is wrong: a half-saved week cannot be told apart from a
  // half-typed one, and "which intervals made it?" is a question no one should have to ask.
  if (problems.length > 0) return { rows: [], problems }

  const rows = [...byDay.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([dayOfWeek, intervals]) =>
      mergeIntervals(intervals).map(({ start, end }) => ({
        dayOfWeek,
        startMinute: start,
        endMinute: end,
      })),
    )

  return { rows, problems }
}

/**
 * Rows back into grid shape: always seven days, intervals merged and in time order.
 *
 * The inverse of `normalizeWeekWrite`, for the standing-schedule editor. Merging on the way out as
 * well as on the way in means the grid can never show a seam the database does not have — a
 * half-hour cell painted twice is one interval on both sides of the wire.
 */
export function daysFromRows(rows: readonly AvailabilityWrite[]): DayWrite[] {
  return Array.from({ length: DAYS_PER_WEEK }, (_, dayOfWeek) => ({
    dayOfWeek,
    intervals: mergeIntervals(
      rows
        .filter((row) => row.dayOfWeek === dayOfWeek)
        .map((row) => ({ start: row.startMinute, end: row.endMinute })),
    ),
  }))
}

/**
 * Whether this week still takes writes: a week in the visible window, or a finished one the
 * captain explicitly unlocked (§5, §8).
 *
 * Visibility and writability are deliberately different questions: the window decides what you
 * can *see* (derived from today, never stored), `unlockedAt` decides what you can *change*.
 */
export function isWeekWritable(
  week: { startsOn: string; unlockedAt: Date | null },
  windowStart: string,
): boolean {
  if (week.unlockedAt) return true

  const lastVisible = addDays(windowStart, (VISIBLE_WEEKS - 1) * 7)
  return week.startsOn >= windowStart && week.startsOn <= lastVisible
}
