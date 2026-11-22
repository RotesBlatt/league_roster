import { describe, expect, test } from 'bun:test'
import {
  applyGesture,
  type Cell,
  daysFromGrid,
  emptyGrid,
  formatMinute,
  gridFromDays,
  hourTicks,
  SLOT_MINUTES,
  startGesture,
} from '../../../src/lib/planner/availability-grid.ts'

/**
 * The painted grid, without React.
 *
 * Everything the UI needs to be *sure* about lives here: cell ↔ interval mapping in both
 * directions, the "first cell decides paint or erase" rule, and the fact that a drag is computed
 * from the grid it started on, so dragging back shrinks the paint instead of accumulating it.
 */

const at = (hour: number, minute = 0) => hour * 60 + minute
const cell = (dayOfWeek: number, index: number): Cell => ({ dayOfWeek, cell: index })

const painted = (grid: boolean[][], dayOfWeek: number, index: number) =>
  grid[dayOfWeek]?.[index] ?? false

const paintedCells = (grid: boolean[][], dayOfWeek: number) =>
  (grid[dayOfWeek] ?? [])
    .map((isPainted, index) => (isPainted ? index : -1))
    .filter((index) => index >= 0)

describe('the grid', () => {
  test('is seven days of 48 half-hour cells, nothing painted', () => {
    expect(SLOT_MINUTES).toBe(30)

    const grid = emptyGrid()

    expect(grid).toHaveLength(7)
    expect(grid.every((day) => day.length === 48)).toBe(true)
    expect(grid.flat().some(Boolean)).toBe(false)
  })

  test('an interval covers the cells it touches, end exclusive', () => {
    const grid = gridFromDays([{ dayOfWeek: 1, intervals: [{ start: at(20), end: at(21) }] }])

    expect(paintedCells(grid, 1)).toEqual([40, 41])
    expect(paintedCells(grid, 0)).toEqual([])
  })

  test('the last half hour paints the last cell, and 23:00 paints two', () => {
    const grid = gridFromDays([{ dayOfWeek: 6, intervals: [{ start: 1410, end: 1440 }] }])
    const fromEleven = gridFromDays([{ dayOfWeek: 6, intervals: [{ start: 1380, end: 1440 }] }])

    expect(painted(grid, 6, 47)).toBe(true)
    expect(painted(grid, 6, 46)).toBe(false)
    expect(painted(fromEleven, 6, 46)).toBe(true)
  })

  test('several days and unsorted intervals all land', () => {
    const grid = gridFromDays([
      { dayOfWeek: 4, intervals: [{ start: 1200, end: 1260 }] },
      { dayOfWeek: 0, intervals: [{ start: 540, end: 720 }] },
    ])

    expect(paintedCells(grid, 0)).toEqual([18, 19, 20, 21, 22, 23])
    expect(paintedCells(grid, 4)).toEqual([40, 41])
  })

  test('a painted run becomes one interval, and gaps stay gaps', () => {
    const grid = emptyGrid()
    for (const index of [10, 11, 12, 20]) grid[2]![index] = true

    expect(daysFromGrid(grid)[2]).toEqual({
      dayOfWeek: 2,
      intervals: [
        { start: 300, end: 390 },
        { start: 600, end: 630 },
      ],
    })
  })

  test('all seven days come back, empty ones included — the save is explicit then', () => {
    const days = daysFromGrid(emptyGrid())

    expect(days.map((day) => day.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(days.every((day) => day.intervals.length === 0)).toBe(true)
  })

  test('a fully painted day is one 0–1440 interval, not 48 cells', () => {
    const grid = emptyGrid()
    grid[3] = Array.from({ length: 48 }, () => true)

    expect(daysFromGrid(grid)[3]).toEqual({
      dayOfWeek: 3,
      intervals: [{ start: 0, end: 1440 }],
    })
  })

  test('round trip merges what touches: 9–12 and 12–15 is one 9–15', () => {
    const days = daysFromGrid(
      gridFromDays([
        {
          dayOfWeek: 5,
          intervals: [
            { start: 540, end: 720 },
            { start: 720, end: 900 },
          ],
        },
      ]),
    )

    expect(days[5]?.intervals).toEqual([{ start: 540, end: 900 }])
  })
})

describe('a gesture', () => {
  test('the first cell decides: a free cell paints, a painted cell erases', () => {
    const free = emptyGrid()
    const filled = gridFromDays([{ dayOfWeek: 1, intervals: [{ start: 1200, end: 1380 }] }])

    expect(startGesture(free, cell(1, 40)).mode).toBe('paint')
    expect(startGesture(filled, cell(1, 40)).mode).toBe('erase')
  })

  test('a drag paints the whole range, whichever way it goes', () => {
    const gesture = startGesture(emptyGrid(), cell(2, 20))

    expect(paintedCells(applyGesture(gesture, cell(2, 24)), 2)).toEqual([20, 21, 22, 23, 24])
    expect(paintedCells(applyGesture(gesture, cell(2, 16)), 2)).toEqual([16, 17, 18, 19, 20])
  })

  test('dragging back shrinks the paint instead of adding to it', () => {
    const gesture = startGesture(emptyGrid(), cell(0, 10))
    const far = applyGesture(gesture, cell(0, 20))
    expect(paintedCells(far, 0)).toHaveLength(11)

    // still the same gesture, now ending two cells from the anchor
    expect(paintedCells(applyGesture(gesture, cell(0, 12)), 0)).toEqual([10, 11, 12])
  })

  test('erasing and dragging back up does not repaint what was just cleared', () => {
    // a full evening 09:00–15:00, cells 18…29
    const grid = gridFromDays([{ dayOfWeek: 1, intervals: [{ start: 540, end: 900 }] }])
    const gesture = startGesture(grid, cell(1, 20))

    const down = applyGesture(gesture, cell(1, 25))
    expect(paintedCells(down, 1)).toEqual([18, 19, 26, 27, 28, 29])

    // the pointer comes back up: 23–25 were erased on the way down and must stay erased
    const backUp = applyGesture(gesture, cell(1, 22))
    expect(paintedCells(backUp, 1)).toEqual([18, 19, 26, 27, 28, 29])
  })

  test('erasing clears the range and leaves the rest of the day alone', () => {
    const grid = gridFromDays([{ dayOfWeek: 1, intervals: [{ start: 540, end: 900 }] }])
    const gesture = startGesture(grid, cell(1, 20))

    const erased = applyGesture(gesture, cell(1, 23))

    expect(erased[1]?.slice(18, 24)).toEqual([true, true, false, false, false, false])
    expect(paintedCells(erased, 1)).toEqual([18, 19, 24, 25, 26, 27, 28, 29])
  })

  test('a tap paints exactly one cell', () => {
    const gesture = startGesture(emptyGrid(), cell(4, 7))

    expect(paintedCells(applyGesture(gesture, cell(4, 7)), 4)).toEqual([7])
  })

  test('a drag that wanders to another day changes nothing there', () => {
    const gesture = startGesture(emptyGrid(), cell(0, 5))
    const strayed = applyGesture(gesture, cell(3, 9))

    expect(paintedCells(strayed, 0)).toEqual([5])
    expect(paintedCells(strayed, 3)).toEqual([])
  })

  test('the gesture never mutates the grid it started from — undo is just that grid', () => {
    const grid = emptyGrid()
    const gesture = startGesture(grid, cell(6, 0))

    applyGesture(gesture, cell(6, 5))

    expect(grid.flat().some(Boolean)).toBe(false)
    expect(gesture.base.flat().some(Boolean)).toBe(false)
  })
})

describe('formatMinute', () => {
  test('reads like a clock, and midnight is not 00:00 at the end of a day', () => {
    expect(formatMinute(0)).toBe('00:00')
    expect(formatMinute(540)).toBe('09:00')
    expect(formatMinute(1290)).toBe('21:30')
    expect(formatMinute(1440)).toBe('24:00')
  })
})

describe('hourTicks — the ruler above the grid', () => {
  test('every two hours, starting at midnight, one tick per two cells', () => {
    const ticks = hourTicks()

    expect(ticks).toHaveLength(12)
    expect(ticks[0]).toEqual({ cell: 0, hour: 0 })
    expect(ticks[1]).toEqual({ cell: 4, hour: 2 })
    expect(ticks.at(-1)).toEqual({ cell: 44, hour: 22 })
  })

  test('a coarser ruler on narrow screens still starts at midnight and stays aligned', () => {
    const ticks = hourTicks(4)

    expect(ticks.map((tick) => tick.hour)).toEqual([0, 4, 8, 12, 16, 20])
    expect(ticks.every((tick) => tick.cell === tick.hour * (60 / SLOT_MINUTES))).toBe(true)
  })
})
