import { describe, expect, test } from 'bun:test'
import type { PlannerWeekDto } from '@lol/api/schema-types'
import { CELLS_PER_DAY, DAYS_PER_WEEK } from '../src/availability-grid.ts'
import { coverageFromWeek, playableFromWeek } from '../src/playable-grid.ts'

/** A week with nothing said yet: seven days, no answers, no availability. */
/** Indexing with `noUncheckedIndexedAccess` makes every raw `grid[d][c]` "possibly undefined". */
const count = (grid: number[][], dayOfWeek: number, cell: number) => grid[dayOfWeek]?.[cell]
const marked = (grid: boolean[][], dayOfWeek: number, cell: number) =>
  grid[dayOfWeek]?.[cell] === true

function week(overrides: Partial<PlannerWeekDto> = {}): PlannerWeekDto {
  return {
    startsOn: '2025-11-24',
    unlocked: false,
    answered: [],
    unanswered: [],
    availability: [],
    days: Array.from({ length: DAYS_PER_WEEK }, (_, dayOfWeek) => ({ dayOfWeek, windows: [] })),
    ...overrides,
  }
}

describe('coverageFromWeek', () => {
  test('an unanswered week is seven empty rows, not a missing grid', () => {
    const coverage = coverageFromWeek(week())

    expect(coverage).toHaveLength(DAYS_PER_WEEK)
    expect(coverage.every((day) => day.length === CELLS_PER_DAY)).toBe(true)
    expect(coverage.flat().every((count) => count === 0)).toBe(true)
  })

  test('nobody free is zero, five overlapping people is five', () => {
    const coverage = coverageFromWeek(
      week({
        availability: ['a', 'b', 'c', 'd', 'e'].map((userId) => ({
          userId,
          dayOfWeek: 1,
          startMinute: 19 * 60,
          endMinute: 21 * 60,
        })),
      }),
    )

    // 18:30–19:00 is the cell before the interval: untouched
    expect(count(coverage, 1, 37)).toBe(0)
    // 19:00–19:30 and 20:30–21:00 are inside it
    expect(count(coverage, 1, 38)).toBe(5)
    expect(count(coverage, 1, 41)).toBe(5)
    // 21:00–21:30 is the exclusive end
    expect(count(coverage, 1, 42)).toBe(0)
    expect(count(coverage, 0, 38)).toBe(0)
  })

  test('a half-covered cell does not count: one free person from 19:15 is not free at 19:00', () => {
    const coverage = coverageFromWeek(
      week({
        availability: [
          { userId: 'a', dayOfWeek: 3, startMinute: 19 * 60 + 15, endMinute: 20 * 60 },
        ],
      }),
    )

    expect(count(coverage, 3, 38)).toBe(0)
    expect(count(coverage, 3, 39)).toBe(1)
  })

  test('the same person twice in one cell is counted once, and the same id on two days twice', () => {
    const coverage = coverageFromWeek(
      week({
        availability: [
          { userId: 'a', dayOfWeek: 2, startMinute: 20 * 60, endMinute: 22 * 60 },
          { userId: 'a', dayOfWeek: 2, startMinute: 20 * 60, endMinute: 21 * 60 },
          { userId: 'a', dayOfWeek: 4, startMinute: 20 * 60, endMinute: 21 * 60 },
        ],
      }),
    )

    expect(count(coverage, 2, 40)).toBe(1)
    expect(count(coverage, 4, 40)).toBe(1)
  })
})

describe('playableFromWeek', () => {
  const windows = [
    {
      dayOfWeek: 1,
      windows: [
        {
          start: 19 * 60,
          end: 21 * 60,
          users: ['a', 'b', 'c', 'd'],
          count: 4,
          missing: ['e'],
        },
      ],
    },
  ]

  test('only the cells a playable window covers are marked', () => {
    const playable = playableFromWeek(
      week({
        days: Array.from(
          { length: DAYS_PER_WEEK },
          (_, d) => windows[d] ?? { dayOfWeek: d, windows: [] },
        ),
      }),
    )

    expect(marked(playable, 1, 38)).toBe(true)
    expect(marked(playable, 1, 41)).toBe(true)
    // the window ends exclusively at 21:00
    expect(marked(playable, 1, 42)).toBe(false)
    // and it is Tuesday, not Wednesday
    expect(marked(playable, 2, 38)).toBe(false)
  })

  test('no windows means nothing is playable, even if people overlap', () => {
    const playable = playableFromWeek(
      week({
        availability: ['a', 'b', 'c', 'd'].map((userId) => ({
          userId,
          dayOfWeek: 1,
          startMinute: 19 * 60,
          endMinute: 21 * 60,
        })),
      }),
    )

    expect(playable.flat().some(Boolean)).toBe(false)
  })

  test('a window that does not sit on cell boundaries still lights the cells it fully covers', () => {
    const playable = playableFromWeek(
      week({
        days: Array.from({ length: DAYS_PER_WEEK }, (_, d) =>
          d === 6
            ? {
                dayOfWeek: d,
                windows: [
                  { start: 19 * 60 + 10, end: 20 * 60 + 50, users: [], count: 4, missing: [] },
                ],
              }
            : { dayOfWeek: d, windows: [] },
        ),
      }),
    )

    // 19:00–19:30 is not fully inside the window, 19:30–20:00 and 20:00–20:30 are
    expect(marked(playable, 6, 38)).toBe(false)
    expect(marked(playable, 6, 39)).toBe(true)
    expect(marked(playable, 6, 40)).toBe(true)
    expect(marked(playable, 6, 41)).toBe(false)
  })
})
