import type { ChampionStatDto } from '@lol/api/schema-types'
import { Table, Text } from '@mantine/core'
import { formatStatsDate, formatWinrate, formatWinsLosses } from '../../lib/matches/stats-view.ts'
import { ChampionLabel } from '../champions/ChampionIcon.tsx'

/**
 * One player's champions (match-history.md §8) — the left-hand table of the target screenshot.
 *
 * Flat on purpose: the pool grouping of the design ("Main pool / Situativ") belongs to a later
 * patch, and a table that lies about its groups is worse than one that has none.
 *
 * `WR` is tinted from the same `winrateTone` the rest of the feature uses, so the colour and the
 * number cannot disagree; zero games is `–` and grey, never a red 0%.
 */
export function ChampionStatsTable({
  champions,
  compact = false,
}: {
  champions: ChampionStatDto[]
  compact?: boolean
}) {
  if (champions.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        No games yet.
      </Text>
    )
  }

  return (
    <Table fz={compact ? 'xs' : 'sm'} verticalSpacing={4} highlightOnHover>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Champion</Table.Th>
          <Table.Th ta="right">Games</Table.Th>
          <Table.Th ta="right">W / L</Table.Th>
          <Table.Th ta="right">WR</Table.Th>
          <Table.Th ta="right">Last</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {champions.map((champion) => (
          <Table.Tr key={champion.championId}>
            <Table.Td>
              <ChampionLabel championId={champion.championId} size={compact ? 16 : 20} />
            </Table.Td>
            <Table.Td ta="right">{champion.games}</Table.Td>
            <Table.Td ta="right">{formatWinsLosses(champion.wins, champion.losses)}</Table.Td>
            <Table.Td ta="right">
              <Text component="span" c={winrateToneFor(champion.winrate, champion.games)} inherit>
                {formatWinrate(champion.winrate)}
              </Text>
            </Table.Td>
            <Table.Td ta="right">
              <Text size="xs" c="dimmed">
                {formatStatsDate(champion.lastPlayedAt)}
              </Text>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}

/** Theme tokens, not colour names — the same reasoning as `RESULT_TONE` in `games-view.ts`. */
function winrateToneFor(winrate: number | null, games: number): string {
  if (games === 0 || winrate === null) return 'var(--mantine-color-dimmed)'
  if (winrate >= 55) return 'var(--mantine-color-teal-6)'
  if (winrate >= 45) return 'var(--mantine-color-yellow-6)'
  return 'var(--mantine-color-red-6)'
}
