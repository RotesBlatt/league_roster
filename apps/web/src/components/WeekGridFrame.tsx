import { Stack, Text } from '@mantine/core'
import type { ReactNode } from 'react'
import {
  CELLS_PER_DAY,
  DAYS_PER_WEEK,
  formatMinute,
  hourTicks,
  SLOT_MINUTES,
} from '../availability-grid.ts'
import { dateOfWeekDay } from '../planner.ts'

/**
 * The week grid's chrome — the axis, the day heads, the row rules — shared by the grid you paint and
 * the grid you read.
 *
 * Both are the same week seen from two sides: mine, and everybody's. Drawing that geometry twice
 * would let them drift apart in row height or in where the 18:00 line sits, which silently breaks
 * the one thing the pair is for — reading one against the other. So the frame is here, and each
 * component supplies only what a cell *is*: a button you can press, or a coloured div you can't.
 */

export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

/** The time gutter. Wide enough for "23:00" at the label size, declared once for every row. */
const GUTTER = 46
/** Days across the top, times down the side: the way a week is read, and the way a calendar is. */
export const COLUMNS = `${GUTTER}px repeat(${DAYS_PER_WEEK}, 1fr)`
export const ROW_HEIGHT = 16

/**
 * A line on every hour, a darker one every six, so 06:00 / 12:00 / 18:00 are findable without
 * counting rows.
 */
export function rowRule(index: number): string {
  if (index % 12 === 0) return '1px solid rgba(0,0,0,0.35)'
  if (index % 2 === 0) return '1px solid rgba(0,0,0,0.12)'
  return 'none'
}

/** `Tue 19:00` — the name of a cell, used for labels, tooltips and test queries alike. */
export function cellName(dayOfWeek: number, minute: number): string {
  return `${DAY_LABELS[dayOfWeek]} ${formatMinute(minute)}`
}

export function WeekGridFrame({
  label,
  startsOn,
  renderCell,
}: {
  label: string
  /** The week's Monday, so each column can be dated (`Mon 23`). Omitted for a standing schedule. */
  startsOn?: string
  renderCell: (cell: { dayOfWeek: number; index: number; minute: number }) => ReactNode
}) {
  const hours = new Map(hourTicks(1).map((tick) => [tick.cell, tick.hour]))

  return (
    <Stack gap={0} role="group" aria-label={label}>
      <div style={{ display: 'grid', gridTemplateColumns: COLUMNS, columnGap: 2 }}>
        <div />
        {DAY_LABELS.map((day, dayOfWeek) => (
          <Stack key={DAY_KEYS[dayOfWeek]} gap={0} align="center">
            <Text size="xs" fw={600} lh={1.4}>
              {day}
            </Text>
            {startsOn && (
              <Text size="10px" c="dimmed" lh={1.2}>
                {dateOfWeekDay(startsOn, dayOfWeek)}
              </Text>
            )}
          </Stack>
        ))}
      </div>

      {Array.from({ length: CELLS_PER_DAY }, (_, index) => {
        const minute = index * SLOT_MINUTES
        const hour = hours.get(index)

        return (
          <div key={minute} style={{ display: 'grid', gridTemplateColumns: COLUMNS, columnGap: 2 }}>
            <Text size="10px" c="dimmed" ta="right" pr={4} lh={`${ROW_HEIGHT}px`}>
              {hour === undefined ? '' : formatMinute(hour * 60)}
            </Text>
            {Array.from({ length: DAYS_PER_WEEK }, (_, dayOfWeek) =>
              renderCell({ dayOfWeek, index, minute }),
            )}
          </div>
        )
      })}
    </Stack>
  )
}
