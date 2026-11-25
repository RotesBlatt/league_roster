import type { PoolPersonDto } from '@lol/api/schema-types'
import { POOL_KIND_LABELS, POOL_KINDS, ROLE_LABELS } from '@lol/shared'
import { Badge, Group, Paper, Stack, Text } from '@mantine/core'
import { useChampions } from '../../api/hooks.ts'
import { championLabelFor, unknownChampionName } from '../../lib/champions/labels.ts'
import { poolAgeText } from '../../lib/pools/pool-view.ts'
import { ChampionIcon } from '../champions/ChampionIcon.tsx'

/**
 * One person's column on the pool page (champion-pools.md §7): header, then the three bands.
 *
 * The bands are **strips of chips in priority order**, not a grid of cells — a three-champion pool
 * and a twelve-champion pool look different, and neither shows empty slots. That is the whole
 * "not a strict grid" the design asked for: the column is the vertical rhythm, the chips wrap.
 *
 * Read-only here; the editable variant of your own column lands next, and it hands in the same
 * person shape, so a column never has two layouts.
 */

/** Icon plus name, sized to sit in a wrapping strip. */
function ChampionChip({ championId }: { championId: number }) {
  const { data } = useChampions()
  const label = championLabelFor(data?.champions, championId)

  return (
    <Group gap={4} wrap="nowrap" title={label?.name ?? unknownChampionName(championId)}>
      <ChampionIcon championId={championId} size={18} />
      <Text size="xs">{label?.name ?? unknownChampionName(championId)}</Text>
    </Group>
  )
}

function PoolBand({
  kind,
  championIds,
}: {
  kind: (typeof POOL_KINDS)[number]
  championIds: number[]
}) {
  return (
    <Stack gap={2}>
      <Group justify="space-between" gap={4} wrap="nowrap">
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
          {POOL_KIND_LABELS[kind]}
        </Text>
        {championIds.length > 0 ? (
          <Text size="xs" c="dimmed">
            {championIds.length}
          </Text>
        ) : null}
      </Group>
      {championIds.length === 0 ? (
        <Text size="xs" c="dimmed">
          —
        </Text>
      ) : (
        <Group gap={6}>
          {championIds.map((championId) => (
            <ChampionChip key={championId} championId={championId} />
          ))}
        </Group>
      )}
    </Stack>
  )
}

export function PoolColumn({
  person,
  isMine,
  now,
}: {
  person: PoolPersonDto
  isMine: boolean
  /** Passed in so every column states its age against the same clock. */
  now: number
}) {
  const age = poolAgeText(person.updatedAt, now)

  return (
    <Paper withBorder p="sm" radius="md" h="100%" opacity={person.isActive ? 1 : 0.6}>
      <Stack gap="sm">
        <Group justify="space-between" gap={4} wrap="nowrap" align="flex-start">
          <div>
            <Text fw={500} size="sm">
              {person.displayName}
            </Text>
            <Text size="xs" c="dimmed">
              {person.role ? ROLE_LABELS[person.role] : 'unassigned'}
            </Text>
          </div>
          {/* the column that is yours says so; everyone else's is a read */}
          {isMine ? (
            <Badge size="xs" variant="light">
              you
            </Badge>
          ) : null}
        </Group>

        {POOL_KINDS.map((kind) => (
          <PoolBand key={kind} kind={kind} championIds={person.lists[kind]} />
        ))}

        <Text size="xs" c="dimmed">
          {age ?? 'no pool yet'}
        </Text>
      </Stack>
    </Paper>
  )
}
