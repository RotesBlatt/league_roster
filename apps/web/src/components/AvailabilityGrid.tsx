import { Stack, Text } from '@mantine/core'
import {
  CELLS_PER_DAY,
  type Cell,
  DAYS_PER_WEEK,
  formatMinute,
  type Grid,
  hourTicks,
  SLOT_MINUTES,
} from '../availability-grid.ts'
import { dateOfWeekDay } from '../planner.ts'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

/** The time gutter. Wide enough for "23:00" at the label size, declared once for every row. */
const GUTTER = 46
/** Days across the top, times down the side: the way a week is read, and the way a calendar is. */
const COLUMNS = `${GUTTER}px repeat(${DAYS_PER_WEEK}, 1fr)`
const ROW_HEIGHT = 16

/**
 * The painted week: a time axis down the left, one column per day.
 *
 * It owns no state and decides nothing — the gesture rules are `availability-grid.ts` and the state
 * is `use-paint-grid.ts`. It exists so the week editor and the regular-times editor cannot drift
 * apart in look or in what a click means.
 *
 * The axis is not decoration: without it the grid is anonymous squares and "which time did I just
 * paint?" has no answer on screen. Every half hour is a row; the label sits on the hour, and each
 * cell carries its exact range as a tooltip.
 */
export function AvailabilityGrid({
  grid,
  label,
  startsOn,
  onBegin,
  onDrag,
  onEnd,
}: {
  grid: Grid
  label: string
  /** The week's Monday, so each column can be dated (`Mon 23`). Omitted for a standing schedule. */
  startsOn?: string
  onBegin: (cell: Cell) => void
  onDrag: (cell: Cell) => void
  onEnd: () => void
}) {
  const hours = new Map(hourTicks(1).map((tick) => [tick.cell, tick.hour]))

  return (
    <Stack gap={0} aria-label={label}>
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

      {Array.from({ length: CELLS_PER_DAY }, (_, cell) => {
        const minute = cell * SLOT_MINUTES
        const hour = hours.get(cell)
        // a line on every hour, a darker one every six, so 06:00 / 12:00 / 18:00 are findable
        const rule =
          cell % 12 === 0
            ? '1px solid rgba(0,0,0,0.35)'
            : cell % 2 === 0
              ? '1px solid rgba(0,0,0,0.12)'
              : 'none'

        return (
          <div key={minute} style={{ display: 'grid', gridTemplateColumns: COLUMNS, columnGap: 2 }}>
            <Text size="10px" c="dimmed" ta="right" pr={4} lh={`${ROW_HEIGHT}px`}>
              {hour === undefined ? '' : formatMinute(hour * 60)}
            </Text>
            {Array.from({ length: DAYS_PER_WEEK }, (_, dayOfWeek) => {
              const free = grid[dayOfWeek]?.[cell] ?? false
              const cellLabel = `${DAY_LABELS[dayOfWeek]} ${formatMinute(minute)}`

              return (
                <button
                  key={cellLabel}
                  type="button"
                  aria-pressed={free}
                  aria-label={cellLabel}
                  title={`${cellLabel}–${formatMinute(minute + SLOT_MINUTES)}`}
                  onPointerDown={() => onBegin({ dayOfWeek, cell })}
                  onPointerEnter={() => onDrag({ dayOfWeek, cell })}
                  onPointerUp={onEnd}
                  style={{
                    height: ROW_HEIGHT,
                    padding: 0,
                    border: 'none',
                    borderRadius: 0,
                    borderTop: rule,
                    cursor: 'pointer',
                    background: free ? 'var(--mantine-color-brand-6)' : 'rgba(0,0,0,0.045)',
                  }}
                />
              )
            })}
          </div>
        )
      })}
    </Stack>
  )
}
