import type { PoolPersonDto } from '@lol/api/schema-types'
import {
  POOL_KIND_LABELS,
  POOL_KINDS,
  type PoolKind,
  type PoolLists,
  ROLE_LABELS,
} from '@lol/shared'
import { ActionIcon, Badge, Group, Menu, Paper, Stack, Text } from '@mantine/core'
import {
  IconArrowDown,
  IconArrowUp,
  IconEye,
  IconPlus,
  IconTransfer,
  IconTrash,
} from '@tabler/icons-react'
import { useChampions } from '../../api/hooks.ts'
import { championLabelFor, unknownChampionName } from '../../lib/champions/labels.ts'
import { moveAcross, moveWithin, removeChampion } from '../../lib/pools/pool-edit.ts'
import { poolAgeText } from '../../lib/pools/pool-view.ts'
import { ChampionIcon } from '../champions/ChampionIcon.tsx'

/**
 * One person's column on the pool page (champion-pools.md §7): header, then the three bands.
 *
 * The bands are **strips of chips in priority order**, not a grid of cells — a three-champion pool
 * and a twelve-champion pool look different, and neither shows dead slots. The column is the
 * vertical rhythm; the chips wrap.
 *
 * Two modes, one layout: read-only for everybody else, and the same column with a `+` per band and
 * a menu per chip for its owner. Editing works through a **menu**, not three hover buttons on a
 * 200px-wide chip: move up, move down, move between the pool sections, mark blind-pickable, remove.
 * Every entry is a real menu item, so the keyboard reaches it without a drag library.
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

/** The editor's per-chip menu. The rules come from `pool-edit.ts`, never from here. */
function EditableChip({
  championId,
  kind,
  index,
  lists,
  onChange,
}: {
  championId: number
  kind: PoolKind
  index: number
  lists: PoolLists
  onChange: (lists: PoolLists) => void
}) {
  const count = lists[kind].length
  // main <-> situational is a real move; blind is a second opinion about the same champion (§6)
  const otherSection: PoolKind | null =
    kind === 'main' ? 'situational' : kind === 'situational' ? 'main' : null

  return (
    <Menu withinPortal position="bottom-start" shadow="md">
      <Menu.Target>
        <ActionIcon variant="subtle" size="sm" aria-label="Edit champion">
          <ChampionChip championId={championId} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          leftSection={<IconArrowUp size={14} />}
          disabled={index === 0}
          onClick={() => onChange(moveWithin(lists, kind, index, index - 1))}
        >
          Move up
        </Menu.Item>
        <Menu.Item
          leftSection={<IconArrowDown size={14} />}
          disabled={index === count - 1}
          onClick={() => onChange(moveWithin(lists, kind, index, index + 1))}
        >
          Move down
        </Menu.Item>

        {otherSection ? (
          <Menu.Item
            leftSection={<IconTransfer size={14} />}
            onClick={() => onChange(moveAcross(lists, kind, championId, otherSection))}
          >
            Move to {POOL_KIND_LABELS[otherSection]}
          </Menu.Item>
        ) : null}

        {/* already blind-pickable? the menu does not offer it twice */}
        {kind !== 'blind' && !lists.blind.includes(championId) ? (
          <Menu.Item
            leftSection={<IconEye size={14} />}
            onClick={() => onChange(moveAcross(lists, kind, championId, 'blind'))}
          >
            Also blind-pickable
          </Menu.Item>
        ) : null}

        <Menu.Item
          color="red"
          leftSection={<IconTrash size={14} />}
          onClick={() => onChange(removeChampion(lists, kind, championId))}
        >
          Remove
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}

function PoolBand({
  kind,
  lists,
  onChange,
  onAdd,
}: {
  kind: PoolKind
  lists: PoolLists
  /** Absent means read-only. */
  onChange?: (lists: PoolLists) => void
  onAdd?: (kind: PoolKind) => void
}) {
  const championIds = lists[kind]

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

      <Group gap={6}>
        {championIds.length === 0 && !onChange ? (
          <Text size="xs" c="dimmed">
            —
          </Text>
        ) : null}

        {championIds.map((championId, index) =>
          onChange ? (
            <EditableChip
              key={championId}
              championId={championId}
              kind={kind}
              index={index}
              lists={lists}
              onChange={onChange}
            />
          ) : (
            <ChampionChip key={championId} championId={championId} />
          ),
        )}

        {onAdd ? (
          <ActionIcon
            variant="light"
            size="sm"
            aria-label={`Add a champion to ${POOL_KIND_LABELS[kind]}`}
            onClick={() => onAdd(kind)}
          >
            <IconPlus size={12} />
          </ActionIcon>
        ) : null}
      </Group>
    </Stack>
  )
}

export function PoolColumn({
  person,
  isMine,
  now,
  lists,
  onChange,
  onAdd,
}: {
  person: PoolPersonDto
  isMine: boolean
  /** Passed in so every column states its age against the same clock. */
  now: number
  /** The draft while editing; defaults to what the server said. */
  lists?: PoolLists
  /** Both present = this column is editable. The page decides via `canEditPool`. */
  onChange?: (lists: PoolLists) => void
  onAdd?: (kind: PoolKind) => void
}) {
  const age = poolAgeText(person.updatedAt, now)
  const shown = lists ?? person.lists

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
          <PoolBand
            key={kind}
            kind={kind}
            lists={shown}
            {...(onChange ? { onChange } : {})}
            {...(onAdd ? { onAdd } : {})}
          />
        ))}

        <Text size="xs" c="dimmed">
          {age ?? 'no pool yet'}
        </Text>
      </Stack>
    </Paper>
  )
}
