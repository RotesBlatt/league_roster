import type { ChampionLabelDto } from '@lol/api/schema-types'
import { POOL_KIND_LABELS, type PoolKind } from '@lol/shared'
import { ActionIcon, Button, Popover, ScrollArea, Stack, Text, TextInput } from '@mantine/core'
import { IconPlus } from '@tabler/icons-react'
import { useState } from 'react'
import { useChampions } from '../../api/hooks.ts'
import { searchChampions } from '../../lib/champions/search.ts'
import { ChampionIcon } from '../champions/ChampionIcon.tsx'

/**
 * The "add a champion" picker (champion-pools.md §7) — a **popover list**, not a modal.
 *
 * A modal took the page away and covered the pool it was editing, which is wrong for a control that
 * adds one champion to one band. This sits next to the `+` that opened it, scrolls instead of
 * paging, and is **one column**: the width a list needs, so the icons can be big enough to recognise
 * — a 20px icon in a three-column grid is a colour, not a champion.
 *
 * The search is delegated to `searchChampions`, so punctuation in `Kai'Sa` is not the user's
 * problem. Labels come from the cache by id; nothing here stores a name.
 */
export function ChampionPicker({
  kind,
  already,
  onPick,
}: {
  /** The band this `+` belongs to — the title says so, the page does the rest. */
  kind: PoolKind
  /** Ids already in that list: shown but not clickable, so the cap is never hit by accident. */
  already: readonly number[]
  onPick: (championId: number) => void
}) {
  const { data } = useChampions()
  const [opened, setOpened] = useState(false)
  const [query, setQuery] = useState('')
  // the whole cache on open: a truncated initial list reads as "the other champions are missing"
  const results = searchChampions(data?.champions, query)

  const change = (next: boolean) => {
    setOpened(next)
    // a closed popover must not remember yesterday's search
    if (!next) setQuery('')
  }

  return (
    <Popover
      opened={opened}
      onChange={change}
      position="bottom-start"
      withinPortal
      shadow="md"
      width={260}
      trapFocus
    >
      <Popover.Target>
        <ActionIcon
          variant="light"
          size="sm"
          aria-label={`Add a champion to ${POOL_KIND_LABELS[kind]}`}
          onClick={() => change(!opened)}
        >
          <IconPlus size={12} />
        </ActionIcon>
      </Popover.Target>

      <Popover.Dropdown p="xs">
        <Stack gap="xs">
          <TextInput
            size="xs"
            placeholder="Search a champion…"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            data-autofocus
          />

          {data === undefined ? (
            <Text size="xs" c="dimmed">
              Loading champions…
            </Text>
          ) : null}

          {data !== undefined && results.length === 0 ? (
            <Text size="xs" c="dimmed">
              No champion matches “{query}”.
            </Text>
          ) : null}

          <ScrollArea.Autosize mah={360} type="auto">
            <Stack gap={2}>
              {results.map((champion: ChampionLabelDto) => {
                const taken = already.includes(champion.championId)
                return (
                  // `h="auto"` is the fix for the clipped icon: a size preset pins the height
                  <Button
                    key={champion.championId}
                    variant="subtle"
                    color="gray"
                    size="sm"
                    h="auto"
                    py={4}
                    px={4}
                    fullWidth
                    justify="flex-start"
                    disabled={taken}
                    title={taken ? 'Already in this list' : champion.name}
                    leftSection={<ChampionIcon championId={champion.championId} size={48} />}
                    onClick={() => {
                      onPick(champion.championId)
                      change(false)
                    }}
                  >
                    {champion.name}
                  </Button>
                )
              })}
            </Stack>
          </ScrollArea.Autosize>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}
