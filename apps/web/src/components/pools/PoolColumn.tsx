import type { PoolPersonDto } from '@lol/api/schema-types'
import {
  POOL_KIND_LABELS,
  POOL_KINDS,
  type PoolKind,
  type PoolLists,
  ROLE_LABELS,
} from '@lol/shared'
import { Badge, Group, Menu, Paper, Stack, Text, UnstyledButton } from '@mantine/core'
import { IconArrowDown, IconArrowUp, IconEye, IconTransfer, IconTrash } from '@tabler/icons-react'
import { useChampions } from '../../api/hooks.ts'
import { championLabelFor, unknownChampionName } from '../../lib/champions/labels.ts'
import { moveAcross, moveWithin, removeChampion } from '../../lib/pools/pool-edit.ts'
import { poolAgeText } from '../../lib/pools/pool-view.ts'
import { ChampionIcon } from '../champions/ChampionIcon.tsx'
import { ChampionPicker } from './ChampionPicker.tsx'

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

/**
 * A champion in a band: the **icon only**, large enough to recognise.
 *
 * The name is gone on purpose — the icon is the champion here, and the name doubled the width of
 * every chip while the column is a strip, not a table. The name survives as `title`/`aria-label`,
 * so hovering and screen readers still get it.
 *
 * Size is the whole point: at 24px a chip was a colour, and the clipping bug (an `ActionIcon` fixed
 * at 30px wrapping icon+name) made it a sliver. **56px with a 4px gap puts four icons on one row** of
 * the five-column page (4 × 56 + 3 × 4 = 236px inside ~246px of column at the page's 90rem width).
 * That width is part of the decision, not a coincidence: at the old 72rem the column held ~190px and
 * the fourth chip wrapped, turning a pool into a ladder again.
 */
const CHIP_ICON = 56

function ChampionChip({ championId, size = CHIP_ICON }: { championId: number; size?: number }) {
  const { data } = useChampions()
  const label = championLabelFor(data?.champions, championId)
  const name = label?.name ?? unknownChampionName(championId)

  return (
    <span title={name} aria-label={name} role="img">
      <ChampionIcon championId={championId} size={size} />
    </span>
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
        {/* an UnstyledButton, not an ActionIcon: the latter is a fixed square and clipped the chip */}
        <UnstyledButton aria-label="Edit champion" p={0}>
          <ChampionChip championId={championId} />
        </UnstyledButton>
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
  onPick,
}: {
  kind: PoolKind
  lists: PoolLists
  /** Absent means read-only. */
  onChange?: (lists: PoolLists) => void
  /** Absent means read-only too: the `+` and its popover belong to the editor. */
  onPick?: (championId: number) => void
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

      <Group gap={4}>
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

        {onPick ? <ChampionPicker kind={kind} already={championIds} onPick={onPick} /> : null}
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
  onPick,
}: {
  person: PoolPersonDto
  isMine: boolean
  /** Passed in so every column states its age against the same clock. */
  now: number
  /** The draft while editing; defaults to what the server said. */
  lists?: PoolLists
  /** Both present = this column is editable. The page decides via `canEditPool`. */
  onChange?: (lists: PoolLists) => void
  onPick?: (kind: PoolKind, championId: number) => void
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
            {...(onPick ? { onPick: (championId: number) => onPick(kind, championId) } : {})}
          />
        ))}

        <Text size="xs" c="dimmed">
          {age ?? 'no pool yet'}
        </Text>
      </Stack>
    </Paper>
  )
}
