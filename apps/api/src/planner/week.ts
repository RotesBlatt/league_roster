/**
 * The planner's calendar logic, as pure functions (availability-planner.md §5, §6).
 *
 * No database, no request, no clock of its own: an instant and a zone go in, ISO dates come out, so
 * the sliding window can be tested without a team and without waiting for Monday.
 *
 * Dates are `YYYY-MM-DD` strings throughout. They describe a **wall-clock day in the team's zone**,
 * which is why they are not instants and why the arithmetic below happens in UTC on purpose — a
 * calendar day has no timezone of its own, and letting one in would reintroduce the DST bug (§3).
 */

/** How far ahead the captain may skip. A guardrail, not a feature: nobody gets stuck in 2027. */
export const MAX_SKIP_WEEKS = 8

const DAY_MS = 86_400_000
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function utcDay(value: string): number {
  const match = ISO_DATE.exec(value)
  if (!match) throw new Error(`not an ISO date: ${value}`)

  const [, year, month, day] = match
  return Date.UTC(Number(year), Number(month) - 1, Number(day))
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Calendar days, not 24-hour blocks: `addDays('2026-10-25', 7)` is the following Sunday. */
export function addDays(date: string, days: number): string {
  return isoDate(utcDay(date) + days * DAY_MS)
}

/** The Monday of that date's week. Sunday belongs to the week that started six days earlier. */
export function startOfWeek(date: string): string {
  const weekday = new Date(utcDay(date)).getUTCDay() // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7))
}

/**
 * The calendar day it is *for the team*, not for the server. An unknown zone throws (Intl refuses
 * it) instead of quietly falling back to UTC and shifting everybody's week.
 */
export function todayInZone(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value

  const year = part('year')
  const month = part('month')
  const day = part('day')
  if (!year || !month || !day) throw new Error(`could not read the date in ${timezone}`)

  return `${year}-${month}-${day}`
}

/**
 * The first week the planner shows: `max(this week, floor)`.
 *
 * `max` is the whole trick of §5 — a skip set on a Wednesday quietly stops mattering the following
 * Monday, so there is no reset job and no counter that leaves a team permanently ahead. A floor that
 * is not a Monday is normalised to its week rather than trusted.
 */
export function resolveWindowStart(
  now: Date,
  opts: { floor: string | null; timezone: string },
): string {
  const thisWeek = startOfWeek(todayInZone(now, opts.timezone))
  if (!opts.floor) return thisWeek

  const floorWeek = startOfWeek(opts.floor)
  return floorWeek > thisWeek ? floorWeek : thisWeek
}

/**
 * The captain's skip, one step at a time, relative to the **effective** start (not to today, or a
 * second skip on the same Wednesday would go nowhere).
 *
 * `applied` is part of the answer on purpose: a click that changes nothing must be tellable apart
 * from a click that worked, so the route can say "that is as far as this goes" instead of lying.
 */
export function moveFloor(
  now: Date,
  opts: { floor: string | null; weeks: number; timezone: string },
): { floor: string | null; applied: boolean } {
  const thisWeek = startOfWeek(todayInZone(now, opts.timezone))
  const current = resolveWindowStart(now, opts)
  const target = addDays(current, opts.weeks * 7)

  if (opts.weeks > 0) {
    const cap = addDays(thisWeek, MAX_SKIP_WEEKS * 7)
    if (target > cap) return { floor: opts.floor, applied: false }
    return { floor: target, applied: true }
  }

  if (opts.weeks < 0) {
    // Back past this week is not "undo the skip", it is "back to today" — the window never shows
    // the past. An unskipped planner has nothing to undo, so that click reports itself as a no-op.
    if (target > thisWeek) return { floor: target, applied: true }
    if (opts.floor === null) return { floor: null, applied: false }
    return { floor: null, applied: true }
  }

  return { floor: opts.floor, applied: false }
}

/**
 * Who has answered and who has not (§4, §7). The **roster** is the authority: an answer row from
 * someone who has since left the team is not an answer about this team, and a member with no answer
 * row is the captain's chase list — including the member who is free nowhere, whose answer is a row
 * with zero intervals.
 *
 * Roster order is kept, so the UI does not shuffle people around between renders.
 */
export function splitAnswers(
  roster: readonly string[],
  answered: readonly string[],
): { answered: string[]; unanswered: string[] } {
  const yes = new Set(answered)

  return {
    answered: roster.filter((user) => yes.has(user)),
    unanswered: roster.filter((user) => !yes.has(user)),
  }
}
