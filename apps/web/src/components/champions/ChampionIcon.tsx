import { Group, Image, Text } from '@mantine/core'
import { useChampions } from '../../api/hooks.ts'
import { championLabelFor, unknownChampionName } from '../../lib/champions/labels.ts'

/**
 * How a champion is rendered anywhere in the app (hexserve-champion-data.md §4, §11 step 4).
 *
 * Components take an **id**, never a name or an icon URL: those are derived from the cache at
 * render time, so no page can store a label that goes out of date. The id can come from a pool
 * cell, a match row or a header — nothing here knows which.
 *
 * The one absolute rule (§7): **no id can make this throw.** Unknown, still loading, empty cache
 * and failed request all render a placeholder, because a page that works is worth more than a
 * champion that is correct.
 */

type ChampionProps = {
  championId: number
  size?: number
}

/** The icon alone, for dense rows. */
export function ChampionIcon({ championId, size = 24 }: ChampionProps) {
  const { data } = useChampions()
  const label = championLabelFor(data?.champions, championId)

  if (!label) {
    // the id is visible, not only a tooltip: a title is invisible on a phone, and "which champion
    // is missing?" should be answerable from the screen (§7)
    return (
      <Text size="xs" c="dimmed" w={size} ta="center" title={unknownChampionName(championId)}>
        #{championId}
      </Text>
    )
  }

  return (
    <Image
      src={label.iconUrl}
      alt={label.name}
      w={size}
      h={size}
      radius="sm"
      // the icons are square by construction; without this Mantine pads them into a letterbox
      fit="contain"
    />
  )
}

/** Icon plus name — what a pool cell, a match row or a stats table shows. */
export function ChampionLabel({ championId, size = 20 }: ChampionProps) {
  const { data } = useChampions()
  const label = championLabelFor(data?.champions, championId)

  return (
    <Group gap={6} wrap="nowrap">
      <ChampionIcon championId={championId} size={size} />
      <Text size="sm">{label?.name ?? unknownChampionName(championId)}</Text>
    </Group>
  )
}
