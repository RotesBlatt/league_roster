import { useDroppable } from '@dnd-kit/core'
import { Box, Group, Text } from '@mantine/core'
import { IconTrash } from '@tabler/icons-react'
import { TRASH_ID } from '../../lib/pools/drag.ts'
import styles from './TrashZone.module.css'

/**
 * The bin a dragged champion can be thrown into (champion-pools.md §7).
 *
 * **A strip under the grid**, not a fixed corner: the first version sat at the viewport's right edge,
 * which on a wide screen is a long drag away from the chips and easy to miss. It is in the page flow
 * (so it sits exactly under the table you are dragging from), it spans the same width as the grid,
 * and it is `sticky bottom` so it stays reachable when a full pool makes the page tall.
 *
 * Visible only while something is being dragged — an idle bin invites "does this delete my pool?" —
 * and it **pushes the page down** while it is there, which is honest: it is part of the page, not an
 * overlay nobody notices.
 *
 * It lives inside the one page-level `DndContext` because a droppable outside a column is
 * unreachable from a chip that belongs to a different context.
 */
export function TrashZone({ visible }: { visible: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: TRASH_ID })

  if (!visible) return null

  return (
    <Box ref={setNodeRef} className={styles.zone} data-over={isOver ? 'true' : undefined}>
      <Group justify="center" gap="xs">
        <IconTrash size={20} />
        <Text size="sm">Drop here to remove</Text>
      </Group>
    </Box>
  )
}
