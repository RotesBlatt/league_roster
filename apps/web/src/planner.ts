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
 * "This week" and "Next week" for the two visible weeks (computed from the window the API sent,
 * not from the reader's clock), a date for anything else — which is how history is labelled once
 * the captain has skipped past it.
 */
export function weekLabel(startsOn: string, windowStart: string): string {
  if (startsOn === windowStart) return 'This week'

  const next = addDays(windowStart, 7)
  if (startsOn === next) return 'Next week'

  return formatDate(startsOn)
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

/** `28 Sep` — own month table, so the label does not depend on the runtime's ICU data. */
function formatDate(date: string): string {
  const [, month, day] = date.split('-')
  const index = Number(month) - 1
  return `${Number(day)} ${MONTHS[index] ?? month}`
}
