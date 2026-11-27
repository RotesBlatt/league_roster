import type { MatchGameDto } from '@lol/api/schema-types'
import { Badge, Table, Text } from '@mantine/core'
import { kindLabel, resultText, resultTone } from '../../lib/matches/games-view.ts'
import { formatStatsDate, gameLine } from '../../lib/matches/stats-view.ts'
import { ChampionLabel } from '../champions/ChampionIcon.tsx'
import { LaneCellView } from './LaneCell.tsx'

/**
 * One row of a player's game log (match-history.md §9).
 *
 * Extracted from the page so it can be rendered on its own in a test — and it earned that
 * immediately: the **lane opponent** was missing from the log when the old games page was replaced,
 * which is the one column a reader looks for first ("who was I against?"). The pure decision lives in
 * `laneCell`; this component is where it is proved to reach the screen.
 */
export function GameLogRow({ game }: { game: MatchGameDto }) {
  return (
    <Table.Tr>
      <Table.Td>{formatStatsDate(game.gameStartAt)}</Table.Td>
      <Table.Td>
        <Badge size="xs" variant="light">
          {kindLabel(game.kind)}
        </Badge>
      </Table.Td>
      <Table.Td>
        {game.championId === null ? '–' : <ChampionLabel championId={game.championId} size={18} />}
      </Table.Td>
      <Table.Td>
        <Text c={resultTone(game.win)} inherit>
          {resultText(game.win)}
        </Text>
      </Table.Td>
      <Table.Td>
        <Text size="xs">{gameLine(game)}</Text>
      </Table.Td>
      <Table.Td>
        {/* beside the player's own champion, where the screenshot has it */}
        <LaneCellView lane={game.lane.laneOpponent} size={18} withName />
      </Table.Td>
      <Table.Td>
        <Text size="xs" c="dimmed">
          {game.player.account ?? '–'}
        </Text>
      </Table.Td>
      <Table.Td>
        <Text size="xs" c="dimmed">
          {game.note ?? '–'}
        </Text>
      </Table.Td>
    </Table.Tr>
  )
}
