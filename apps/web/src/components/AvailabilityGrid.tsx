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

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

/** Label column + one column per half hour, declared once so every row is aligned by construction. */
const COLUMNS = `32px repeat(${CELLS_PER_DAY}, 1fr)`
/** How many cells one ruler tick spans — two hours at a time. */
const TICK_HOURS = 2
const TICK_SPAN = (TICK_HOURS * 60) / SLOT_MINUTES

/**
 * The painted week, as a dumb component: a clock ruler and seven rows of 48 half-hour buttons.
 *
 * It owns no state and decides nothing — the gesture rules are `availability-grid.ts` and the state
 * is `use-paint-grid.ts`. It exists so the week editor and the regular-times editor cannot drift
 * apart in look or in what a click means.
 *
 * The ruler is not decoration: without it the grid is 48 anonymous squares and "which time did I
 * just paint?" has no answer on screen. Each cell also carries its exact time as a tooltip.
 */
export function AvailabilityGrid({
  grid,
  label,
  onBegin,
  onDrag,
  onEnd,
}: {
  grid: Grid
  label: string
  onBegin: (cell: Cell) => void
  onDrag: (cell: Cell) => void
  onEnd: () => void
}) {
  return (
    <Stack gap={2} aria-label={label}>
      <div style={{ display: 'grid', gridTemplateColumns: COLUMNS, columnGap: 2 }}>
        <div />
        {hourTicks(TICK_HOURS).map((tick) => (
          <Text
            key={tick.hour}
            size="10px"
            c="dimmed"
            lh={1}
            style={{ gridColumn: `span ${TICK_SPAN}`, paddingLeft: 2 }}
          >
            {String(tick.hour).padStart(2, '0')}
          </Text>
        ))}
      </div>

      {Array.from({ length: DAYS_PER_WEEK }, (_, dayOfWeek) => (
        <div
          key={DAY_KEYS[dayOfWeek]}
          style={{ display: 'grid', gridTemplateColumns: COLUMNS, columnGap: 2 }}
        >
          <Text size="xs" c="dimmed" lh={1.4}>
            {DAY_LABELS[dayOfWeek]}
          </Text>
          {Array.from({ length: CELLS_PER_DAY }, (_, cell) => {
            const free = grid[dayOfWeek]?.[cell] ?? false
            const minute = cell * SLOT_MINUTES
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
                  height: 18,
                  padding: 0,
                  border: 'none',
                  borderRadius: 2,
                  // the quarter-hour boundary is darker, so the eye can find 06:00 / 12:00 / 18:00
                  borderLeft: cell % TICK_SPAN === 0 ? '1px solid rgba(0,0,0,0.35)' : 'none',
                  cursor: 'pointer',
                  background: free ? 'var(--mantine-color-brand-6)' : 'rgba(0,0,0,0.06)',
                }}
              />
            )
          })}
        </div>
      ))}
    </Stack>
  )
}
