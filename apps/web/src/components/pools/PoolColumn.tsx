import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { PoolPersonDto } from '@lol/api/schema-types'
import {
  POOL_KIND_LABELS,
  POOL_KINDS,
  type PoolKind,
  type PoolLists,
  ROLE_LABELS,
} from '@lol/shared'
import { Badge, Box, Group, Paper, Stack, Text } from '@mantine/core'
import { useRef, useState } from 'react'
import { useChampions } from '../../api/hooks.ts'
import { championLabelFor, unknownChampionName } from '../../lib/champions/labels.ts'
import { chipActions } from '../../lib/pools/chip-actions.ts'
import {
  bandDragId,
  championDragId,
  type DragTarget,
  dragMove,
  parseDragId,
} from '../../lib/pools/drag.ts'
import { poolAgeText } from '../../lib/pools/pool-view.ts'
import { ChampionIcon } from '../champions/ChampionIcon.tsx'
import { ChampionPicker } from './ChampionPicker.tsx'
import { ChipActions } from './ChipActions.tsx'
import styles from './PoolColumn.module.css'

/**
 * One person's column on the pool page (champion-pools.md §7): header, then the three bands.
 *
 * The bands are **strips of chips in priority order**, not a grid of cells — a three-champion pool
 * and a twelve-champion pool look different, and neither shows dead slots.
 *
 * Two modes, one layout: read-only for everybody else, and the same column for its owner with a `+`
 * per band, right-click actions per chip, and **drag to reorder** (pointer and keyboard). What a
 * drop or an action *means* is decided in `lib/pools` — this file only reports what was grabbed and
 * where it went.
 */

/**
 * A champion in a band: the **icon only**, large enough to recognise.
 *
 * The name is gone on purpose — the icon is the champion here, and the name doubled the width of
 * every chip while the column is a strip, not a table. The name survives as `title`/`aria-label`.
 *
 * Size is the whole point: at 24px a chip was a colour, and the clipping bug (an `ActionIcon` fixed
 * at 30px wrapping icon+name) made it a sliver. **56px with a 4px gap puts four icons on one row** of
 * the five-column page (4 × 56 + 3 × 4 = 236px inside ~246px of column at the page's 90rem width).
 * That width is part of the decision, not a coincidence.
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

/**
 * A chip that can be dragged, and whose actions open **at the pointer** on right click.
 *
 * No trigger element: left button drags (dnd-kit holds the pointer), right button opens the panel.
 * The two gestures cannot fight because they are different buttons, and because the panel is not a
 * `Menu` — it never toggles itself on click, so a click that survives a drag cannot open it.
 *
 * Keyboard: **Shift+F10** (the platform context-menu convention) opens the same actions anchored to
 * the chip's own box; Enter/Space stay dnd-kit's keyboard drag.
 */
function SortableChip({
  championId,
  kind,
  index,
  lists,
  onChange,
  dropTarget,
}: {
  championId: number
  kind: PoolKind
  index: number
  lists: PoolLists
  onChange: (lists: PoolLists) => void
  /** Where the chip being dragged would land right now, so the target can show it. */
  dropTarget: DragTarget | null
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: championDragId(kind, championId),
  })
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const node = useRef<HTMLDivElement | null>(null)

  // a line *before* this chip: the dragged champion lands at this index, pushing this one right
  const isLandingHere = dropTarget?.kind === kind && dropTarget.championId === championId

  return (
    <Box
      ref={(element) => {
        setNodeRef(element)
        node.current = element
      }}
      pos="relative"
      className={[
        styles.chip,
        isDragging ? styles.dragging : '',
        isLandingHere ? styles.dropBefore : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onContextMenu={(event) => {
        event.preventDefault()
        setMenuAt({ x: event.clientX, y: event.clientY })
      }}
      onKeyDown={(event) => {
        if (event.shiftKey && event.key === 'F10') {
          event.preventDefault()
          const box = node.current?.getBoundingClientRect()
          setMenuAt({ x: box?.left ?? 0, y: (box?.bottom ?? 0) + 4 })
          return
        }
        // every other key still belongs to dnd-kit's keyboard sensor
        listeners?.onKeyDown?.(event)
      }}
    >
      <ChampionChip championId={championId} />

      <ChipActions
        at={menuAt}
        actions={chipActions(lists, kind, championId, index)}
        onClose={() => setMenuAt(null)}
        onApply={(action) => onChange(action.apply())}
      />
    </Box>
  )
}

/** The chips of one band, as a sortable list that is also a drop target when empty. */
function BandChips({ kind, lists, onChange, onPick, dropTarget }: BandProps) {
  const championIds = lists[kind]
  // a band with no chips has nothing sortable, so it has to accept a drop itself
  const { setNodeRef, isOver } = useDroppable({ id: bandDragId(kind) })

  return (
    <Group
      gap={4}
      ref={setNodeRef}
      mih={CHIP_ICON}
      className={isOver ? styles.bandOver : undefined}
    >
      <SortableContext
        items={championIds.map((championId) => championDragId(kind, championId))}
        strategy={rectSortingStrategy}
      >
        {championIds.map((championId, index) => (
          <SortableChip
            key={championId}
            championId={championId}
            kind={kind}
            index={index}
            lists={lists}
            onChange={onChange}
            dropTarget={dropTarget}
          />
        ))}
      </SortableContext>

      {onPick ? <ChampionPicker kind={kind} already={championIds} onPick={onPick} /> : null}
    </Group>
  )
}

type BandProps = {
  kind: PoolKind
  lists: PoolLists
  onChange: (lists: PoolLists) => void
  onPick: (championId: number) => void
  dropTarget: DragTarget | null
}

function PoolBand({
  kind,
  lists,
  onChange,
  onPick,
  dropTarget,
}: {
  kind: PoolKind
  lists: PoolLists
  /** Absent means read-only. */
  onChange?: (lists: PoolLists) => void
  /** Absent means read-only too: the `+` and its popover belong to the editor. */
  onPick?: (championId: number) => void
  dropTarget?: DragTarget | null
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

      {onChange && onPick ? (
        <BandChips
          kind={kind}
          lists={lists}
          onChange={onChange}
          onPick={onPick}
          dropTarget={dropTarget ?? null}
        />
      ) : (
        <Group gap={4}>
          {championIds.length === 0 ? (
            <Text size="xs" c="dimmed">
              —
            </Text>
          ) : null}
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

  // pointer drag needs a few pixels of intent, so a plain click stays a click;
  // the keyboard sensor gives the same move through space/arrow keys on a focused chip
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // what the drag is over right now, so the target can show where the champion lands
  const [dropTarget, setDropTarget] = useState<DragTarget | null>(null)

  const bands = POOL_KINDS.map((kind) => (
    <PoolBand
      key={kind}
      kind={kind}
      lists={shown}
      dropTarget={dropTarget}
      {...(onChange ? { onChange } : {})}
      {...(onPick ? { onPick: (championId: number) => onPick(kind, championId) } : {})}
    />
  ))

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

        {onChange ? (
          <DndContext
            sensors={sensors}
            // pointer first: the chip *under the cursor* is where it lands, and the band behind it
            // only wins in the gaps and at the end (an empty band has nothing else to hit).
            // `closestCenter` is the fallback for keyboard dragging, which has no pointer at all.
            collisionDetection={(args) => {
              const underPointer = pointerWithin(args)
              return underPointer.length > 0 ? underPointer : closestCenter(args)
            }}
            onDragOver={(event) =>
              setDropTarget(parseDragId(event.over ? String(event.over.id) : null))
            }
            onDragCancel={() => setDropTarget(null)}
            onDragEnd={(event) => {
              // clear first: the indicator must be gone when the chips move under it
              setDropTarget(null)
              onChange(
                dragMove(shown, String(event.active.id), event.over ? String(event.over.id) : null),
              )
            }}
          >
            {bands}
          </DndContext>
        ) : (
          bands
        )}

        <Text size="xs" c="dimmed">
          {age ?? 'no pool yet'}
        </Text>
      </Stack>
    </Paper>
  )
}
