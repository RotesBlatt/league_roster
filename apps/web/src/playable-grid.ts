/**
 * The team's half of the planner, as a plain module — no React, no DOM, no fetch.
 *
 * `availability-grid.ts` is what *I* paint; this is what *everybody* said, projected onto the same
 * 7 × 48 cells so the two grids can be read against each other. Nothing here decides anything: the
 * playable windows themselves are the server's (`findPlayWindows`, availability-planner.md §6), and
 * this only turns them back into cells for display.
 */

import type { PlannerWeekDto } from '@lol/api/schema-types'
import { CELLS_PER_DAY, DAYS_PER_WEEK, SLOT_MINUTES } from './availability-grid.ts'

/** `true` = this cell sits inside a playable window. Index 0 is 00:00–00:30. */
export type CellMask = boolean[][]

const rows = () =>
  Array.from({ length: DAYS_PER_WEEK }, () => new Array<number>(CELLS_PER_DAY).fill(0))

const startOf = (cell: number) => cell * SLOT_MINUTES
const endOf = (cell: number) => startOf(cell) + SLOT_MINUTES

/**
 * How many people are free in each cell.
 *
 * A cell counts a person only when their interval covers the *whole* half hour: 19:15–20:00 is not
 * "free at 19:00", and rounding it up would inflate every count on the grid. Two rows for the same
 * person in one cell count once — a count is people, not statements.
 */
export function coverageFromWeek(week: PlannerWeekDto): number[][] {
  const coverage = rows()

  for (let dayOfWeek = 0; dayOfWeek < DAYS_PER_WEEK; dayOfWeek++) {
    const row = coverage[dayOfWeek]
    if (!row) continue

    const mine = week.availability.filter((entry) => entry.dayOfWeek === dayOfWeek)
    if (mine.length === 0) continue

    for (let cell = 0; cell < CELLS_PER_DAY; cell++) {
      const from = startOf(cell)
      const to = endOf(cell)
      const users = new Set(
        mine
          .filter((entry) => entry.startMinute <= from && entry.endMinute >= to)
          .map((entry) => entry.userId),
      )
      row[cell] = users.size
    }
  }

  return coverage
}

/**
 * The cells a playable window covers, so a qualifying evening reads as one block instead of "some
 * cells happen to be dark".
 *
 * Only cells the window *fully* contains are marked; a window is on cell boundaries in practice,
 * but a half-covered cell must not look like a place we could start.
 */
export function playableFromWeek(week: PlannerWeekDto): CellMask {
  const playable = Array.from({ length: DAYS_PER_WEEK }, () =>
    new Array<boolean>(CELLS_PER_DAY).fill(false),
  )

  for (const day of week.days) {
    const row = playable[day.dayOfWeek]
    if (!row) continue

    for (const window of day.windows) {
      for (let cell = 0; cell < CELLS_PER_DAY; cell++) {
        if (window.start <= startOf(cell) && window.end >= endOf(cell)) row[cell] = true
      }
    }
  }

  return playable
}
