import { Group, Stack, Text } from '@mantine/core'
import {
  CELLS_PER_DAY,
  type Cell,
  DAYS_PER_WEEK,
  formatMinute,
  type Grid,
  SLOT_MINUTES,
} from '../availability-grid.ts'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

/**
 * The painted week, as a dumb component: seven rows of 48 half-hour buttons.
 *
 * It owns no state and decides nothing — the gesture rules are `availability-grid.ts` and the
 * state is `use-paint-grid.ts`. It exists so the week editor and the regular-times editor cannot
 * drift apart in look or in what a click means.
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
      {Array.from({ length: DAYS_PER_WEEK }, (_, dayOfWeek) => (
        <Group key={DAY_KEYS[dayOfWeek]} gap={4} wrap="nowrap">
          <Text size="xs" w={32} c="dimmed">
            {DAY_LABELS[dayOfWeek]}
          </Text>
          {Array.from({ length: CELLS_PER_DAY }, (_, cell) => {
            const free = grid[dayOfWeek]?.[cell] ?? false
            const cellLabel = `${DAY_LABELS[dayOfWeek]} ${formatMinute(cell * SLOT_MINUTES)}`

            return (
              <button
                key={cellLabel}
                type="button"
                aria-pressed={free}
                aria-label={cellLabel}
                onPointerDown={() => onBegin({ dayOfWeek, cell })}
                onPointerEnter={() => onDrag({ dayOfWeek, cell })}
                onPointerUp={onEnd}
                style={{
                  flex: 1,
                  height: 18,
                  minWidth: 6,
                  padding: 0,
                  border: 'none',
                  borderLeft: cell % 2 === 0 ? '1px solid rgba(0,0,0,0.15)' : 'none',
                  cursor: 'pointer',
                  background: free ? 'var(--mantine-color-brand-6)' : 'rgba(0,0,0,0.06)',
                }}
              />
            )
          })}
        </Group>
      ))}
    </Stack>
  )
}
