import { beforeEach, describe, expect, test } from 'bun:test'
import type { PlannerWeekDto } from '@lol/api/schema-types'
import { MantineProvider } from '@mantine/core'
import { cleanup, render, screen } from '@testing-library/react'
import { PlayableGrid } from '../src/components/PlayableGrid.tsx'

/**
 * The team's grid: what everybody said, drawn read-only.
 *
 * Tested for what it *shows* and what it refuses to be: the numbers come from `playable-grid.ts`,
 * the windows from the API, and nothing on this grid may be painted.
 */

const week = (overrides: Partial<PlannerWeekDto> = {}): PlannerWeekDto => ({
  startsOn: '2026-11-23',
  unlocked: false,
  noPractice: false,
  answered: ['me'],
  unanswered: ['u3'],
  // 1140 = 19:00, 1200 = 20:00, 1260 = 21:00 — two people leave at 20:00, three stay until 21:00
  availability: [
    { userId: 'me', dayOfWeek: 1, startMinute: 1140, endMinute: 1200 },
    { userId: 'u2', dayOfWeek: 1, startMinute: 1140, endMinute: 1200 },
    { userId: 'u3', dayOfWeek: 1, startMinute: 1140, endMinute: 1260 },
    { userId: 'u4', dayOfWeek: 1, startMinute: 1140, endMinute: 1260 },
    { userId: 'u5', dayOfWeek: 1, startMinute: 1140, endMinute: 1260 },
  ],
  days: Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    windows: dayOfWeek === 1 ? [{ start: 1140, end: 1200, count: 5, users: [], missing: [] }] : [],
  })),
  ...overrides,
})

const renderGrid = (current: PlannerWeekDto = week()) =>
  render(
    <MantineProvider>
      <PlayableGrid week={current} label="Everyone’s availability" />
    </MantineProvider>,
  )

/**
 * Cells are `aria-hidden` divs (a heatmap read out cell by cell is noise), so the observable
 * surface is the tooltip: "Tue 19:00–19:30 · 5 free · playable".
 */
const cell = (label: string) => screen.getByTitle((title) => title.startsWith(`${label}–`))

describe('PlayableGrid', () => {
  beforeEach(() => {
    cleanup()
  })

  test('every cell says how many people are free in it', () => {
    renderGrid()

    // five people are free 19:00–20:00 on Tuesday; three of them stay until 21:00
    expect(cell('Tue 19:00')).toBeDefined()
    expect(cell('Tue 19:00').getAttribute('data-count')).toBe('5')
    expect(cell('Tue 19:30').getAttribute('data-count')).toBe('5')
    expect(cell('Tue 20:00').getAttribute('data-count')).toBe('3')
    expect(cell('Tue 21:00').getAttribute('data-count')).toBe('0')
    expect(cell('Mon 19:00').getAttribute('data-count')).toBe('0')
  })

  test('the count is banded so the grid reads at a glance', () => {
    renderGrid()

    expect(cell('Tue 19:00').getAttribute('data-band')).toBe('many')
    expect(cell('Tue 20:00').getAttribute('data-band')).toBe('few')
    expect(cell('Tue 21:00').getAttribute('data-band')).toBe('none')
  })

  test('the cells a playable window covers are marked, the rest are not', () => {
    renderGrid()

    expect(cell('Tue 19:00').getAttribute('data-playable')).toBe('true')
    expect(cell('Tue 19:30').getAttribute('data-playable')).toBe('true')
    // three people are free at 20:00, but the window ended at 20:00
    expect(cell('Tue 20:00').getAttribute('data-playable')).toBe('false')
  })

  test('it is read-only: nothing on this grid is a control you can press', () => {
    renderGrid()

    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  test('the legend says what the shades and the outline mean', () => {
    renderGrid()

    expect(screen.getByText('nobody')).toBeDefined()
    expect(screen.getByText('1–3')).toBeDefined()
    expect(screen.getByText('4+')).toBeDefined()
    expect(screen.getByText('playable window')).toBeDefined()
  })

  test('a window that qualifies but nobody answered for is still drawn', () => {
    renderGrid(week({ unanswered: ['u3', 'u4', 'u5'], answered: ['me'] }))

    expect(cell('Tue 19:00').getAttribute('data-playable')).toBe('true')
  })
})
