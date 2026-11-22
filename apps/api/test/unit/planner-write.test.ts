import { describe, expect, test } from 'bun:test'
import {
  type DayWrite,
  daysFromRows,
  isWeekWritable,
  normalizeWeekWrite,
  SLOT_MINUTES,
} from '../../src/planner/write.ts'

/**
 * What reaches the database is decided here, not in the handler: a route that "thinks" cannot be
 * tested, and the grid is only one of the callers that may exist later (availability-planner.md §4,
 * §9.1).
 *
 * Two rules are load-bearing:
 *   - input snaps to the grid's 30 minutes — the UI decision stays a UI decision, but a bad client
 *     cannot store 20-minute slivers;
 *   - rows are normalised per day, so one person can never appear twice at the same minute.
 */

const day = (dayOfWeek: number, ...intervals: [number, number][]): DayWrite => ({
  dayOfWeek,
  intervals: intervals.map(([start, end]) => ({ start, end })),
})

describe('normalizeWeekWrite', () => {
  test('the grid the UI paints is accepted as it comes', () => {
    expect(SLOT_MINUTES).toBe(30)

    const { rows, problems } = normalizeWeekWrite([day(1, [1200, 1380], [540, 720])])

    expect(problems).toEqual([])
    expect(rows).toEqual([
      { dayOfWeek: 1, startMinute: 540, endMinute: 720 },
      { dayOfWeek: 1, startMinute: 1200, endMinute: 1380 },
    ])
  })

  test('until midnight is 1440, and it is a legal end', () => {
    expect(normalizeWeekWrite([day(6, [1380, 1440])])).toEqual({
      rows: [{ dayOfWeek: 6, startMinute: 1380, endMinute: 1440 }],
      problems: [],
    })
  })

  test('a 20-minute sliver is refused, and the message names the edge that is off', () => {
    const ending = normalizeWeekWrite([day(2, [540, 560])])
    const starting = normalizeWeekWrite([day(2, [555, 720])])

    expect(ending.rows).toEqual([])
    expect(ending.problems).toEqual([
      { field: 'days[0].intervals[0].end', message: 'Times must sit on a 30-minute boundary' },
    ])
    expect(starting.problems).toEqual([
      { field: 'days[0].intervals[0].start', message: 'Times must sit on a 30-minute boundary' },
    ])
  })

  test('an end at or before the start is refused — no zero-length intervals, no wrap', () => {
    expect(normalizeWeekWrite([day(3, [720, 720])]).problems).toHaveLength(1)
    expect(normalizeWeekWrite([day(3, [900, 720])]).problems).toHaveLength(1)
  })

  test('outside the day is refused', () => {
    expect(normalizeWeekWrite([day(0, [-30, 60])]).problems).toHaveLength(1)
    expect(normalizeWeekWrite([day(0, [1380, 1470])]).problems).toHaveLength(1)
  })

  test('a day outside the week is refused', () => {
    expect(normalizeWeekWrite([day(7, [540, 720])]).problems).toHaveLength(1)
    expect(normalizeWeekWrite([day(-1, [540, 720])]).problems).toHaveLength(1)
  })

  test('non-integers are refused rather than rounded', () => {
    expect(normalizeWeekWrite([day(1, [540.5, 720])]).problems).toHaveLength(1)
    expect(normalizeWeekWrite([day(1.5, [540, 720])]).problems).toHaveLength(1)
  })

  test('adjacent and overlapping intervals on the same day become one row', () => {
    const { rows } = normalizeWeekWrite([day(4, [540, 720], [720, 900], [840, 960])])

    expect(rows).toEqual([{ dayOfWeek: 4, startMinute: 540, endMinute: 960 }])
  })

  test('the same day twice in one body is merged, not written twice', () => {
    const { rows } = normalizeWeekWrite([day(5, [540, 720]), day(5, [720, 900])])

    expect(rows).toEqual([{ dayOfWeek: 5, startMinute: 540, endMinute: 900 }])
  })

  test('rows come out in day order, so the summary does not shuffle between saves', () => {
    const { rows } = normalizeWeekWrite([day(6, [540, 720]), day(0, [600, 660])])

    expect(rows.map((row) => row.dayOfWeek)).toEqual([0, 6])
  })

  test('an answer with no intervals is valid — "I am free nowhere" is a real answer', () => {
    expect(normalizeWeekWrite([])).toEqual({ rows: [], problems: [] })
    expect(normalizeWeekWrite([day(2)])).toEqual({ rows: [], problems: [] })
  })

  test('one bad interval does not silently drop the good ones: nothing is written', () => {
    const { rows, problems } = normalizeWeekWrite([day(1, [540, 720]), day(2, [540, 555])])

    expect(rows).toEqual([])
    expect(problems).toHaveLength(1)
  })
})

describe('isWeekWritable', () => {
  const windowStart = '2026-11-23' // a Monday
  const now = new Date('2026-11-25T10:00:00Z')
  const week = (startsOn: string, unlockedAt: Date | null = null) => ({ startsOn, unlockedAt })
  const writable = (startsOn: string, unlockedAt: Date | null = null, at = now) =>
    isWeekWritable(week(startsOn, unlockedAt), windowStart, at)

  test('this week and next week are the window, and both are writable', () => {
    expect(writable('2026-11-23')).toBe(true)
    expect(writable('2026-11-30')).toBe(true)
  })

  test('a week the window does not show is not writable, even in the future', () => {
    expect(writable('2026-12-07')).toBe(false)
  })

  test('the past is closed — it is history, not a draft', () => {
    expect(writable('2026-11-16')).toBe(false)
  })

  test('a captain can unlock a finished week for writing, and that is the only way in', () => {
    const unlocked = new Date('2026-11-25T10:00:00Z')

    expect(writable('2026-11-16', unlocked)).toBe(true)
    // visibility is derived and unaffected: without the row being unlocked it stays closed
    expect(writable('2026-09-28')).toBe(false)
  })

  test('an unlock expires after seven days, so a forgotten one heals itself', () => {
    const unlocked = new Date('2026-11-18T10:00:00Z')

    expect(writable('2026-11-16', unlocked, new Date('2026-11-25T09:59:59Z'))).toBe(true)
    // exactly seven days later is already expired: the window is half-open like every other
    expect(writable('2026-11-16', unlocked, new Date('2026-11-25T10:00:00Z'))).toBe(false)
    expect(writable('2026-11-16', unlocked, new Date('2026-11-26T10:00:00Z'))).toBe(false)
  })
})

describe('daysFromRows — the template read back into grid shape', () => {
  test('seven days always come out, empty ones included', () => {
    const days = daysFromRows([])

    expect(days.map((entry) => entry.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(days.every((entry) => entry.intervals.length === 0)).toBe(true)
  })

  test('two rows on one day become two intervals, in time order', () => {
    const days = daysFromRows([
      { dayOfWeek: 1, startMinute: 1200, endMinute: 1380 },
      { dayOfWeek: 1, startMinute: 540, endMinute: 720 },
    ])

    expect(days[1]).toEqual({
      dayOfWeek: 1,
      intervals: [
        { start: 540, end: 720 },
        { start: 1200, end: 1380 },
      ],
    })
  })

  test('rows that touch are merged on the way out — the grid cannot show a seam that is not there', () => {
    const days = daysFromRows([
      { dayOfWeek: 3, startMinute: 540, endMinute: 720 },
      { dayOfWeek: 3, startMinute: 720, endMinute: 900 },
    ])

    expect(days[3]?.intervals).toEqual([{ start: 540, end: 900 }])
  })
})
