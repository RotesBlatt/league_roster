import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { Group, Loader, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { useState } from 'react'
import { useParams } from 'react-router'
import { useMe, usePools } from '../api/hooks.ts'
import { EmptyPoolColumn } from '../components/pools/EmptyPoolColumn.tsx'
import { PoolColumn } from '../components/pools/PoolColumn.tsx'
import { TrashZone } from '../components/pools/TrashZone.tsx'
import { applyDrop, type DragTarget, parseDragId } from '../lib/pools/drag.ts'
import { poolColumns } from '../lib/pools/pool-columns.ts'
import { poolCompletion } from '../lib/pools/pool-view.ts'
import { usePoolEditor } from '../lib/pools/use-pool-editor.ts'

/**
 * The team's champion pools (champion-pools.md §7): one **column per person**, five columns
 * left-to-right in role order, each a stack of three bands — Main, Situational, Blind-pickable.
 *
 * **Everyone reads, one column writes.** The page itself only composes: who is on the roster, what
 * the completion line says, and where the bars go. The draft, its save, its refusals and the rule
 * for which column may be edited live in `usePoolEditor`, so this component has no branches worth
 * testing that the hook and the pure modules below it do not already own.
 *
 * Fast and cheap to re-read on purpose: opened during champ select on a second screen, it is one
 * query, no spinner chain, and a player with no pool is a visible gap rather than a missing row.
 */
export function PoolsPage() {
  const { slug = '' } = useParams()
  const me = useMe()
  const pools = usePools(slug)

  const people = pools.data?.people ?? []
  const completion = poolCompletion(people)
  // one clock for the whole page: five columns may not disagree about how old "3 days" is
  const now = Date.now()

  const mine = people.find((person) => person.userId === me.data?.id) ?? null
  const editor = usePoolEditor(mine, me.data ?? null)

  // One context for the whole page, not one per column: the trash bin sits outside every column,
  // and a droppable can only be reached from the same DndContext the chip belongs to.
  const [dragging, setDragging] = useState(false)
  const [dropTarget, setDropTarget] = useState<DragTarget | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const lists = editor.shown

  const onDragEnd = (event: DragEndEvent) => {
    // clear the indicator first: it must be gone when the chips move under it
    setDragging(false)
    setDropTarget(null)
    if (!lists) return

    // the trash, a chip, or nothing — the rule lives in `drag.ts`, so it is testable
    editor.onChange(
      applyDrop(lists, String(event.active.id), event.over ? String(event.over.id) : null),
    )
  }

  return (
    // centred and bounded. 90rem is what makes the four-chips-per-row layout real: five columns at
    // 72rem leave ~190px of content, where the fourth 56px chip wraps. The page owns the width.
    <Stack gap="md" maw="90rem" mx="auto" w="100%">
      <Group justify="space-between" align="baseline">
        <Title order={2}>Champion pools</Title>
        <Group gap="sm">
          {/* autosave: the only thing left to say is that a write is in flight */}
          {editor.saving ? (
            <Text size="sm" c="dimmed">
              saving…
            </Text>
          ) : null}
          {completion.text ? (
            <Text size="sm" c="dimmed">
              {completion.text}
            </Text>
          ) : null}
        </Group>
      </Group>

      {pools.isPending ? <Loader size="sm" /> : null}

      {pools.isError ? (
        <Text size="sm" c="red">
          The pools could not be loaded.
        </Text>
      ) : null}

      {/* always five role slots: an empty column says "nobody here", a missing one changes the
          shape of the page as people join (and the layout is the answer to "who plays what") */}
      <DndContext
        sensors={sensors}
        // pointer first: the chip *under the cursor* is where it lands, and the band behind it
        // only wins in the gaps and at the end (an empty band has nothing else to hit).
        // `closestCenter` is the fallback for keyboard dragging, which has no pointer at all.
        collisionDetection={(args) => {
          const underPointer = pointerWithin(args)
          return underPointer.length > 0 ? underPointer : closestCenter(args)
        }}
        onDragStart={() => setDragging(true)}
        onDragOver={(event) =>
          setDropTarget(parseDragId(event.over ? String(event.over.id) : null))
        }
        onDragCancel={() => {
          setDragging(false)
          setDropTarget(null)
        }}
        onDragEnd={onDragEnd}
      >
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 5 }} spacing="sm" verticalSpacing="sm">
          {poolColumns(people).map(({ role, person }) => {
            if (person === null) {
              // a role with nobody on it: a place in the layout, not a person
              return <EmptyPoolColumn key={`empty-${role ?? 'none'}`} role={role} />
            }

            const isMine = person.userId === me.data?.id
            // the draft belongs to the editable column only; every other column is a read
            const draftLists = editor.shown
            const editableHere = isMine && editor.editing && draftLists !== null

            return (
              <PoolColumn
                key={person.userId}
                person={person}
                isMine={isMine}
                now={now}
                {...(editableHere && draftLists !== null
                  ? {
                      lists: draftLists,
                      onChange: editor.onChange,
                      onPick: editor.onPick,
                      dropTarget,
                    }
                  : {})}
              />
            )
          })}
        </SimpleGrid>

        <TrashZone visible={dragging && editor.editing} />
      </DndContext>
    </Stack>
  )
}
