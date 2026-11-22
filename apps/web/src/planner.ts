import type { PlannerTemplateDto, PlannerWeekDto } from '@lol/api/schema-types'
import { type Interval, mergeIntervals, type PlayWindow } from '@lol/shared'
import { DAYS_PER_WEEK, type DayIntervals } from './availability-grid.ts'

/**
 * What the planner page *means*, without React (availability-planner.md §9).
 *
 * The API already does the arithmetic: it returns per-day `windows` computed from real answers.
 * So this module answers only the questions a component would otherwise bury in JSX:
 *
 *   - what does my grid open with — my saved rows, or my standing times as a suggestion?
 *   - which session should the page lead with?
 *   - who is missing, and is the summary still provisional?
 *   - what do we call this week?
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Intervals merged and sorted, and all seven days present — the shape the grid paints. */
function normaliseDays(days: readonly DayIntervals[]): DayIntervals[] {
  return Array.from({ length: DAYS_PER_WEEK }, (_, dayOfWeek) => {
    // every entry for the day, not just the first: `initialDays` hands in one entry per saved
    // row, which is exactly the case that has to merge
    const own = days.filter((day) => day.dayOfWeek === dayOfWeek).flatMap((day) => day.intervals)

    return {
      dayOfWeek,
      intervals: mergeIntervals(own.map(({ start, end }): Interval => ({ start, end }))),
    }
  })
}

/**
 * The grid's starting state.
 *
 * If I answered this week, it is exactly what I said — including "nothing free", which is why the
 * `answered` list and not the rows decide. Otherwise it is my standing schedule, shown as a
 * suggestion: nothing is stored until I save, and until then I count as unanswered (§4b).
 */
export function initialDays(
  week: PlannerWeekDto,
  template: PlannerTemplateDto,
  meId: string,
): DayIntervals[] {
  if (!week.answered.includes(meId)) return normaliseDays(template.days)

  const mine = week.availability
    .filter((row) => row.userId === meId)
    .map((row) => ({
      dayOfWeek: row.dayOfWeek,
      intervals: [{ start: row.startMinute, end: row.endMinute }],
    }))

  return normaliseDays(mine)
}

/** One ranked list: more people first, then the longer session, then the earlier evening. */
export function flattenWindows(week: PlannerWeekDto): (PlayWindow & { dayOfWeek: number })[] {
  return week.days
    .flatMap((day) =>
      day.windows.map((playWindow) => ({ ...playWindow, dayOfWeek: day.dayOfWeek })),
    )
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.end - b.start - (a.end - a.start) ||
        a.start - b.start ||
        a.dayOfWeek - b.dayOfWeek,
    )
}

/** Names for the people a window cannot count on. An unknown id is still shown, never dropped. */
export function missingNames(window: PlayWindow, names: Record<string, string>): string[] {
  return window.missing.map((userId) => names[userId] ?? '?')
}

/** Somebody has not answered, so the windows are "so far", not final (§6). */
export function isProvisional(week: PlannerWeekDto): boolean {
  return week.unanswered.length > 0
}

/** The label above the summary, or null once the week is complete. */
export function provisionalText(week: PlannerWeekDto): string | null {
  if (!isProvisional(week)) return null

  const total = week.answered.length + week.unanswered.length
  return `${week.answered.length} of ${total} answered — these times are provisional`
}

/**
 * The date of one column, `DD.MM` — what a reader needs to anchor "Tue" to a real day. Padded on
 * both ends (`03.12`), so the numbers line up under each other instead of wandering.
 *
 * Not a full date on purpose: the week already names its month, and the column is 1/7 of the grid.
 */
export function dateOfWeekDay(startsOn: string, dayOfWeek: number): string {
  const parts = addDays(startsOn, dayOfWeek).split('-')
  const month = parts[1] ?? ''
  const day = parts[2] ?? ''

  return `${day}.${month}`
}

/**
 * The week that contains "today", as its Monday — the only week a tab may mark as *now*.
 *
 * Derived from the `today` the API sent (the **team's** wall clock), never from the browser's: a
 * member in another timezone must not see a different week highlighted than the rest of the team.
 */
export function currentWeekStart(today: string): string {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay() // 0 = Sunday
  return addDays(today, -((weekday + 6) % 7))
}

/**
 * The week as a range of dates: `23–29 Nov`, `30 Nov – 6 Dec`, or `28 Dec 2026 – 3 Jan 2027`.
 *
 * A planner labelled only "this week" forces the reader to work out which Monday it means from
 * today's date; the dates are the answer, so they are always shown.
 */
export function weekRange(startsOn: string): string {
  const endsOn = addDays(startsOn, 6)
  const [startYear, startMonth, startDay] = startsOn.split('-')
  const [endYear, endMonth, endDay] = endsOn.split('-')

  const start = `${Number(startDay)} ${MONTHS[Number(startMonth) - 1] ?? startMonth}`
  const end = `${Number(endDay)} ${MONTHS[Number(endMonth) - 1] ?? endMonth}`

  // the year is only worth the width when it changes; a range inside one month only needs it once
  if (startYear !== endYear) return `${start} ${startYear} – ${end} ${endYear}`
  if (startMonth !== endMonth) return `${start} – ${end}`

  return `${Number(startDay)}–${Number(endDay)} ${MONTHS[Number(startMonth) - 1] ?? startMonth}`
}

/**
 * ISO week number, so a week can be named the way a fixture list names it ("KW 48").
 *
 * The rule is the calendar's, not ours: the week belongs to the year that owns its Thursday, which
 * is why a week starting 28 Dec can be "week 53" and not "week 0".
 */
export function isoWeekNumber(startsOn: string): number {
  const monday = Date.parse(`${startsOn}T00:00:00Z`)
  const thursday = new Date(monday + 3 * 86_400_000)
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1)

  return Math.floor((thursday.getTime() - yearStart) / 86_400_000 / 7) + 1
}

/**
 * Everything a week tab needs to be unambiguous: its relative name when it has one, the dates it
 * covers, and its ISO week. A past week has no relative name — the dates carry it.
 */
export function weekHeading(startsOn: string, windowStart: string): string {
  const relative =
    startsOn === windowStart
      ? 'This week'
      : startsOn === addDays(windowStart, 7)
        ? 'Next week'
        : null

  const parts = [relative, weekRange(startsOn), `Week ${isoWeekNumber(startsOn)}`]
  return parts.filter((part) => part !== null).join(' · ')
}

/**
 * The `count` weeks before the window, newest first — the history list (§5 "look at a past week").
 * Pure date arithmetic, so a month or year boundary is not a special case.
 */
export function weekStartsBefore(windowStart: string, count: number): string[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) =>
    addDays(windowStart, -7 * (index + 1)),
  )
}

function addDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}
