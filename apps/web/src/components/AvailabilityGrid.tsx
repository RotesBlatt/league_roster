import { type Cell, formatMinute, type Grid, SLOT_MINUTES } from '../availability-grid.ts'
import { cellName, ROW_HEIGHT, rowRule, WeekGridFrame } from './WeekGridFrame.tsx'

/**
 * The painted week: a time axis down the left, one column per day.
 *
 * It owns no state and decides nothing — the gesture rules are `availability-grid.ts`, the state is
 * `use-paint-grid.ts`, and the axis and day heads are `WeekGridFrame` so this cannot drift apart
 * from the read-only team grid that sits beside it.
 *
 * The axis is not decoration: without it the grid is anonymous squares and "which time did I just
 * paint?" has no answer on screen. Every cell carries its exact range as a tooltip.
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
  return (
    <WeekGridFrame
      label={label}
      startsOn={startsOn}
      renderCell={({ dayOfWeek, index, minute }) => {
        const free = grid[dayOfWeek]?.[index] ?? false
        const name = cellName(dayOfWeek, minute)

        return (
          <button
            key={name}
            type="button"
            aria-pressed={free}
            aria-label={name}
            title={`${name}–${formatMinute(minute + SLOT_MINUTES)}`}
            onPointerDown={() => onBegin({ dayOfWeek, cell: index })}
            onPointerEnter={() => onDrag({ dayOfWeek, cell: index })}
            onPointerUp={onEnd}
            style={{
              height: ROW_HEIGHT,
              padding: 0,
              border: 'none',
              borderRadius: 0,
              borderTop: rowRule(index),
              cursor: 'pointer',
              background: free ? 'var(--mantine-color-brand-6)' : 'rgba(0,0,0,0.045)',
            }}
          />
        )
      }}
    />
  )
}
