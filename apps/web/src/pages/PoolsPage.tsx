import type { PoolPersonDto } from '@lol/api/schema-types'
import { Button, Group, Loader, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { useParams } from 'react-router'
import { useMe, usePools } from '../api/hooks.ts'
import { PoolColumn } from '../components/pools/PoolColumn.tsx'
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
            const draftLists = editor.shown
            const editableHere = isMine && editor.editing && draftLists !== null

            return (
              <PoolColumn
                key={person.userId}
                person={person}
                isMine={isMine}
                now={now}
                {...(editableHere && draftLists !== null
                  ? { lists: draftLists, onChange: editor.onChange, onPick: editor.onPick }
                  : {})}
              />
            )
          })}
        </SimpleGrid>
      ) : null}

      {editor.editing && editor.hasDraft ? (
        <Group justify="flex-end" gap="xs">
          <Text size="xs" c="dimmed">
            unsaved changes
          </Text>
          <Button variant="default" size="xs" onClick={editor.onDiscard} disabled={!editor.dirty}>
            Discard
          </Button>
          <Button
            size="xs"
            onClick={editor.onSave}
            loading={editor.saving}
            disabled={!editor.dirty}
          >
            Save pool
          </Button>
        </Group>
      ) : null}
    </Stack>
  )
}
