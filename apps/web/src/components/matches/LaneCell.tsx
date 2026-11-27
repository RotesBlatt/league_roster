import type { MatchLaneRefDto } from '@lol/api/schema-types'
import { Text } from '@mantine/core'
import { laneCell } from '../../lib/matches/games-view.ts'
import { ChampionIcon, ChampionLabel } from '../champions/ChampionIcon.tsx'

/**
 * One lane cell: a teammate by name, an enemy by **the champion's real name and icon** (§7, §9).
 *
 * Extracted when the games list became the stats views: the lane opponent is still the thing a
 * reader looks for ("who was I against?"), and it appeared on two pages before, so it appears on two
 * pages again — as one component, not two copies.
 *
 * The decision itself is `laneCell` in the pure module (tested): a name for ours, a champion id for
 * an enemy we hold no account for, nothing when nobody typed it.
 */
export function LaneCellView({
  lane,
  size = 16,
  withName = false,
}: {
  lane: MatchLaneRefDto | null
  /** Icon size; the log shows something small, a detail view may show more. */
  size?: number
  /** `true` renders the champion's name beside the icon, `false` only the icon. */
  withName?: boolean
}) {
  const cell = laneCell(lane)

  if (cell.kind === 'none') return <Text size="sm">–</Text>
  if (cell.kind === 'name') return <Text size="sm">{cell.name}</Text>

  // `ChampionLabel` is icon **plus** name; the bare icon needs `ChampionLabel`'s sibling, so the
  // label component is used when a name is wanted and a plain icon otherwise
  return withName ? (
    <ChampionLabel championId={cell.championId} size={size} />
  ) : (
    <ChampionIcon championId={cell.championId} size={size} />
  )
}
