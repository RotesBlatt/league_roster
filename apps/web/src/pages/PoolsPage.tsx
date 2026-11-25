import type { PoolPersonDto } from '@lol/api/schema-types'
import { Group, Loader, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { useParams } from 'react-router'
import { useMe, usePools } from '../api/hooks.ts'
import { PoolColumn } from '../components/pools/PoolColumn.tsx'
import { poolCompletion } from '../lib/pools/pool-view.ts'

/**
 * The team's champion pools (champion-pools.md §7): one **column per person**, five columns
 * left-to-right in role order, each a stack of three bands — Main, Situational, Blind-pickable.
 *
 * Read-only for everyone today. Your own column becomes editable in the next slice; it is the same
 * `PoolColumn`, so the layout does not change when the handles appear.
 *
 * Fast and cheap to re-read on purpose: this page is opened during champ select on a second screen,
 * so it is one query, no modal, no spinner chain — and a player with no pool is a visible gap, not a
 * missing row.
 */
export function PoolsPage() {
  const { slug = '' } = useParams()
  const me = useMe()
  const pools = usePools(slug)

  const people = pools.data?.people ?? []
  const completion = poolCompletion(people)
  // one clock for the whole page: five columns may not disagree about how old "3 days" is
  const now = Date.now()

  return (
    <Stack gap="md">
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
          {people.map((person: PoolPersonDto) => (
            <PoolColumn
              key={person.userId}
              person={person}
              isMine={person.userId === me.data?.id}
              now={now}
            />
          ))}
        </SimpleGrid>
      ) : null}
    </Stack>
  )
}
