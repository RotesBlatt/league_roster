import type { PoolPersonDto } from '@lol/api/schema-types'
import { canEditPool, type PoolKind, type PoolLists } from '@lol/shared'
import { Button, Group, Loader, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { POOLS_KEY, useMe, usePools, useSavePool } from '../api/hooks.ts'
import { PoolColumn } from '../components/pools/PoolColumn.tsx'
import { addChampion } from '../lib/pools/pool-edit.ts'
import { isDirty, saveFailure } from '../lib/pools/pool-save.ts'
import { poolCompletion } from '../lib/pools/pool-view.ts'

/**
 * The team's champion pools (champion-pools.md §7): one **column per person**, five columns
 * left-to-right in role order, each a stack of three bands — Main, Situational, Blind-pickable.
 *
 * **Everyone reads, one column writes.** Which column that is comes from the shared
 * `canEditPool(me, ownerId)` — the same rule the API enforces, so the affordance and the guard
 * agree before a request is sent.
 *
 * Editing is a **draft**: a menu move or a picker add touches local state, and one `Save pool` sends
 * the whole pool with the `version` this page read. That is what makes the stale case legible (§5):
 * if somebody saved from another tab meanwhile, the server answers 409 and we discard the draft and
 * show their version instead of overwriting it.
 *
 * Fast and cheap to re-read on purpose: this page is opened during champ select on a second screen,
 * so it is one query, no spinner chain, and a player with no pool is a visible gap, not a missing row.
 */
export function PoolsPage() {
  const { slug = '' } = useParams()
  const me = useMe()
  const pools = usePools(slug)
  const save = useSavePool()
  const queryClient = useQueryClient()

  const [draft, setDraft] = useState<PoolLists | null>(null)

  const people = pools.data?.people ?? []
  const completion = poolCompletion(people)
  // one clock for the whole page: five columns may not disagree about how old "3 days" is
  const now = Date.now()

  const mine = people.find((person) => person.userId === me.data?.id) ?? null
  const editable = mine !== null && canEditPool(me.data ?? null, mine.userId)
  const shown = draft ?? mine?.lists ?? null
  const dirty = mine !== null && isDirty(draft, mine.lists)
  const version = mine?.version ?? null

  // a new server version — our save, or somebody else's — makes the draft stale by definition
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the trigger, not a read
  useEffect(() => {
    setDraft(null)
  }, [version])

  const onSave = () => {
    if (!mine || !draft) return

    save.mutate(
      { version: mine.version, lists: draft },
      {
        onSuccess: () => {
          setDraft(null)
          notifications.show({ message: 'Pool saved', color: 'green' })
        },
        onError: (error) => {
          const failure = saveFailure(error)
          if (failure.reload) {
            // 409: the stored pool won. Dropping the draft *and* refetching is what makes
            // "showing the latest version" true — the cache still holds the version we read.
            setDraft(null)
            void queryClient.invalidateQueries({ queryKey: POOLS_KEY })
          }
          notifications.show({ message: failure.message, color: failure.color })
        },
      },
    )
  }

  /** The `+` in a band opens its own popover; this only records the pick in the draft. */
  const onPick = (kind: PoolKind, championId: number) => {
    if (!shown) return
    setDraft(addChampion(shown, kind, championId))
  }

  return (
    // centred and bounded. 90rem is what makes the four-chips-per-row layout real: five columns at
    // 72rem leave ~190px of content, where the fourth 56px chip wraps. The page owns the width.
    <Stack gap="md" maw="90rem" mx="auto" w="100%">
      <Group justify="space-between" align="baseline">
        <Title order={2}>Champion pools</Title>
        {completion.text ? (
          <Text size="sm" c="dimmed">
            {completion.text}
          </Text>
        ) : null}
      </Group>

      {pools.isPending ? <Loader size="sm" /> : null}

      {pools.isError ? (
        <Text size="sm" c="red">
          The pools could not be loaded.
        </Text>
      ) : null}

      {!pools.isPending && !pools.isError && people.length === 0 ? (
        <Text size="sm" c="dimmed">
          Nobody is on the roster yet, so there is no pool to show.
        </Text>
      ) : null}

      {people.length > 0 ? (
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 5 }} spacing="sm" verticalSpacing="sm">
          {people.map((person: PoolPersonDto) => {
            const isMine = person.userId === me.data?.id
            // the draft belongs to the editable column only; every other column is a read
            const editing = isMine && editable && shown !== null

            return (
              <PoolColumn
                key={person.userId}
                person={person}
                isMine={isMine}
                now={now}
                {...(editing ? { lists: shown, onChange: setDraft, onPick } : {})}
              />
            )
          })}
        </SimpleGrid>
      ) : null}

      {editable && draft !== null ? (
        <Group justify="flex-end" gap="xs">
          <Text size="xs" c="dimmed">
            unsaved changes
          </Text>
          <Button variant="default" size="xs" onClick={() => setDraft(null)} disabled={!dirty}>
            Discard
          </Button>
          <Button size="xs" onClick={onSave} loading={save.isPending} disabled={!dirty}>
            Save pool
          </Button>
        </Group>
      ) : null}
    </Stack>
  )
}
