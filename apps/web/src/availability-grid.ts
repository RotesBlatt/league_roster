/**
 * The week planner's painted grid, as a plain module — no React, no DOM, no fetch.
 *
 * A week is 7 × 48 half-hour cells. The grid is the *input*: what is stored is still minutes
 * (`[start, end)` on the team's wall clock), so granularity stays a UI decision and the data model
 * never learns about cells (availability-planner.md §3, §9.1).
 *
 * Two rules live here because they are the ones a component gets wrong:
 *   - the first cell of a gesture decides paint or erase, and the whole drag keeps that mode;
 *   - a drag is computed from the grid the gesture started on, so dragging back *shrinks* the
 *     painted range instead of accumulating cells behind the cursor.
 */

/** One cell is half an hour. The API validates the same boundary, so a mismatch fails loudly. */
export const SLOT_MINUTES = 30
export const DAYS_PER_WEEK = 7
export const CELLS_PER_DAY = (24 * 60) / SLOT_MINUTES

/** `true` = free. Index 0 is 00:00–00:30, index 47 is 23:30–24:00. */
export type Grid = boolean[][]

export type Cell = { dayOfWeek: number; cell: number }

export type DayIntervals = {
  dayOfWeek: number
  intervals: { start: number; end: number }[]
}

export type GestureMode = 'paint' | 'erase'

export type Gesture = {
  /** The grid before the gesture: restoring it is the one-step undo. */
  base: Grid
  mode: GestureMode
  dayOfWeek: number
  /** Where the pointer went down; the range is always anchor ↔ current. */
  anchor: number
}

const range = (length: number) => Array.from({ length }, () => false)

export function emptyGrid(): Grid {
  return Array.from({ length: DAYS_PER_WEEK }, () => range(CELLS_PER_DAY))
}

const clone = (grid: Grid): Grid => grid.map((day) => [...day])

const isPainted = (grid: Grid, dayOfWeek: number, index: number) =>
  grid[dayOfWeek]?.[index] === true

const insideGrid = (cell: Cell) =>
  cell.dayOfWeek >= 0 &&
  cell.dayOfWeek < DAYS_PER_WEEK &&
  cell.cell >= 0 &&
  cell.cell < CELLS_PER_DAY

/**
 * Stored intervals → cells. `end` is exclusive, so `[1200, 1380)` paints 40…45 and `1440` paints
 * the last cell: "until midnight" needs no special case anywhere.
 */
export function gridFromDays(days: readonly DayIntervals[]): Grid {
  const grid = emptyGrid()

  for (const day of days) {
    const row = grid[day.dayOfWeek]
    if (!row) continue

    for (const { start, end } of day.intervals) {
      const first = Math.max(0, Math.floor(start / SLOT_MINUTES))
      const last = Math.min(CELLS_PER_DAY - 1, Math.ceil(end / SLOT_MINUTES) - 1)
      for (let index = first; index <= last; index++) row[index] = true
    }
  }

  return grid
}

/**
 * Cells → stored intervals: all seven days, runs of painted cells as `[start, end)`, adjacent runs
 * merged. An unpainted week is seven empty lists, which is a valid save ("free nowhere").
 */
export function daysFromGrid(grid: Grid): DayIntervals[] {
  return Array.from({ length: DAYS_PER_WEEK }, (_, dayOfWeek) => {
    const row = grid[dayOfWeek] ?? []
    const intervals: { start: number; end: number }[] = []
    let start = -1

    for (let index = 0; index <= row.length; index++) {
      const free = row[index] === true
      if (free && start === -1) start = index
      if (!free && start !== -1) {
        intervals.push({ start: start * SLOT_MINUTES, end: index * SLOT_MINUTES })
        start = -1
      }
    }

    return { dayOfWeek, intervals }
  })
}

/** A gesture begins on a cell; what that cell currently is decides what the whole drag does. */
export function startGesture(grid: Grid, cell: Cell): Gesture {
  return {
    base: grid,
    mode: isPainted(grid, cell.dayOfWeek, cell.cell) ? 'erase' : 'paint',
    dayOfWeek: cell.dayOfWeek,
    anchor: cell.cell,
  }
}

/**
 * Apply the drag up to `cell`, always from the gesture's base.
 *
 * A pointer that wanders to another day is ignored: intervals are per day, and a diagonal drag
 * silently painting a second evening is worse than a drag that needs to stay on its row.
 */
export function applyGesture(gesture: Gesture, cell: Cell): Grid {
  if (!insideGrid(cell) || cell.dayOfWeek !== gesture.dayOfWeek) {
    // keep what the gesture had; only the last position inside this day counts
    return applyRange(gesture, gesture.anchor)
  }

  return applyRange(gesture, cell.cell)
}

function applyRange(gesture: Gesture, current: number): Grid {
  const grid = clone(gesture.base)
  const row = grid[gesture.dayOfWeek]
  if (!row) return grid

  const from = Math.min(gesture.anchor, current)
  const to = Math.max(gesture.anchor, current)
  for (let index = from; index <= to; index++) row[index] = gesture.mode === 'paint'

  return grid
}

/**
 * The ruler above the grid: one tick every `stepHours` (two by default), each aligned to the cell it
 * starts on. Without it a painted grid is 48 anonymous squares, and nobody can tell whether the
 * evening they just blocked out starts at 18:00 or at 21:00.
 */
export function hourTicks(stepHours = 2): { cell: number; hour: number }[] {
  const step = Math.max(1, Math.round(stepHours))

  return Array.from({ length: Math.floor(24 / step) }, (_, index) => ({
    cell: index * step * (60 / SLOT_MINUTES),
    hour: index * step,
  }))
}

/** `09:00`, and `24:00` for the exclusive end that means midnight. */
export function formatMinute(minute: number): string {
  const hours = Math.floor(minute / 60)
  const minutes = minute % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}
