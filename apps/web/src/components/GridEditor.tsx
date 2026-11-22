import { Button, Group, Stack, Text } from '@mantine/core'
import { IconArrowBackUp } from '@tabler/icons-react'
import type { Cell, Grid } from '../availability-grid.ts'
import { AvailabilityGrid } from './AvailabilityGrid.tsx'

/**
 * The week grid and its toolbar, once.
 *
 * Two things on this page are the same table: the availability I paint for a week, and the standing
 * times I keep for every week. They differ only in the sentence above them and in what the save
 * writes — so they are rendered by one component, and "the save buttons look the same" is a fact
 * about the code rather than a thing two files happen to agree on today.
 *
 * The editor owns no state: the grid and the gesture handlers come from `usePaintGrid`, the save
 * mutation from the caller. That keeps the painting rules testable without a DOM, and keeps the two
 * callers from growing their own toolbar.
 */
export function GridEditor({
  label,
  startsOn,
  description,
  grid,
  onBegin,
  onDrag,
  onEnd,
  onUndo,
  canUndo,
  dirty,
  saving,
  saveLabel,
  onSave,
}: {
  /** The grid's accessible name: `Your availability` or `Regular times grid`. */
  label: string
  /** The week's Monday when the grid is about one week; omitted for a standing schedule. */
  startsOn?: string
  /** What this grid means, on the left of the toolbar. */
  description: string
  grid: Grid
  onBegin: (cell: Cell) => void
  onDrag: (cell: Cell) => void
  onEnd: () => void
  onUndo: () => void
  canUndo: boolean
  dirty: boolean
  saving: boolean
  saveLabel: string
  onSave: () => void
}) {
  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start" gap="md" wrap="nowrap">
        <Text size="sm" c="dimmed">
          {description}
        </Text>
        <Group gap="xs" wrap="nowrap">
          <Button
            variant="subtle"
            size="xs"
            leftSection={<IconArrowBackUp size={14} />}
            onClick={onUndo}
            disabled={!canUndo}
          >
            Undo
          </Button>
          <Button size="sm" onClick={onSave} loading={saving} disabled={!dirty}>
            {saveLabel}
          </Button>
        </Group>
      </Group>

      <AvailabilityGrid
        grid={grid}
        label={label}
        startsOn={startsOn}
        onBegin={onBegin}
        onDrag={onDrag}
        onEnd={onEnd}
      />
    </Stack>
  )
}
