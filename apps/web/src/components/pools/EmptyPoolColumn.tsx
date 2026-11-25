import { ROLE_LABELS, type Role } from '@lol/shared'
import { Paper, Stack, Text } from '@mantine/core'
import styles from './EmptyPoolColumn.module.css'

/**
 * A role nobody occupies yet (champion-pools.md §7).
 *
 * It exists so the page always has the same five shapes: an empty column with a role heading says
 * "we have nobody here", while a missing column makes the grid jitter as people join and leaves the
 * reader counting to find out which role is gone. It is deliberately not a `PoolColumn` — there is no
 * name, no owner and no pool to edit, and pretending otherwise would mean a person-shaped object
 * with no person in it.
 */
export function EmptyPoolColumn({ role }: { role: Role | null }) {
  return (
    <Paper withBorder p="sm" radius="md" h="100%" className={styles.empty}>
      <Stack gap={4}>
        <Text fw={500} size="sm" c="dimmed">
          {role ? ROLE_LABELS[role] : 'No role'}
        </Text>
        <Text size="xs" c="dimmed">
          no player yet
        </Text>
      </Stack>
    </Paper>
  )
}
