import type { ChampionLabelDto } from '@lol/api/schema-types'
import { POOL_KIND_LABELS, type PoolKind } from '@lol/shared'
import { Button, Modal, SimpleGrid, Stack, Text, TextInput } from '@mantine/core'
import { useState } from 'react'
import { useChampions } from '../../api/hooks.ts'
import { searchChampions } from '../../lib/champions/search.ts'
import { ChampionIcon } from '../champions/ChampionIcon.tsx'

/**
 * The "add a champion" picker (champion-pools.md §7).
 *
 * A modal because it is the one place the page needs focus: a column is a strip of chips, and a
 * dropdown over five narrow columns would cover the pool it is editing. Searching is delegated to
 * `searchChampions`, so punctuation in `Kai'Sa` is not the user's problem.
 *
 * The cache is fetched by id only — the modal never stores a name, and an unknown champion id is
 * simply not offered rather than rendered wrong (the cache is the only source of labels).
 */
export function ChampionPicker({
  opened,
  kind,
  already,
  onPick,
  onClose,
}: {
  opened: boolean
  /** Which list the champion is going into — the title says so, the page does the rest. */
  kind: PoolKind | null
  /** Ids already in the target list: shown but not clickable, so the cap is never hit by accident. */
  already: readonly number[]
  onPick: (championId: number) => void
  onClose: () => void
}) {
  const { data } = useChampions()
  const [query, setQuery] = useState('')
  const results = searchChampions(data?.champions, query, 60)

  const close = () => {
    setQuery('')
    onClose()
  }

  return (
    <Modal
      opened={opened}
      onClose={close}
      size="lg"
      title={kind ? `Add to ${POOL_KIND_LABELS[kind]}` : 'Add champion'}
    >
      <Stack gap="sm">
        <TextInput
          autoFocus
          placeholder="Search a champion…"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />

        {data === undefined ? (
          <Text size="sm" c="dimmed">
            Loading champions…
          </Text>
        ) : null}

        {data !== undefined && results.length === 0 ? (
          <Text size="sm" c="dimmed">
            No champion matches “{query}”.
          </Text>
        ) : null}

        <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs">
          {results.map((champion: ChampionLabelDto) => {
            const taken = already.includes(champion.championId)
            return (
              <Button
                key={champion.championId}
                variant="subtle"
                size="xs"
                justify="flex-start"
                leftSection={<ChampionIcon championId={champion.championId} size={20} />}
                disabled={taken}
                title={taken ? 'Already in this list' : undefined}
                onClick={() => onPick(champion.championId)}
              >
                {champion.name}
              </Button>
            )
          })}
        </SimpleGrid>
      </Stack>
    </Modal>
  )
}
