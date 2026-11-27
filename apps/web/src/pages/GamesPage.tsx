import type { MatchGameDto } from '@lol/api/schema-types'
import { type MatchScope, ROLE_LABELS } from '@lol/shared'
import {
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core'
import { useState } from 'react'
import { useParams } from 'react-router'
import { useGames } from '../api/hooks.ts'
// from `result.ts`, not `api.ts`: the app-wide UI tests mock `api.ts` wholesale, and a named import
// the mock does not provide fails at module load instead of at the call site
import { messageOf } from '../api/result.ts'
import { ChampionIcon, ChampionLabel } from '../components/champions/ChampionIcon.tsx'
import {
  formatGameTime,
  formatKda,
  GAMES_SCOPE_OPTIONS,
  groupByMatch,
  kindLabel,
  laneLabel,
  provenanceLabel,
  resultText,
  resultTone,
  teamCountText,
} from '../lib/matches/games-view.ts'

/**
 * The games list (match-history.md §9) — the sheet's left-hand table.
 *
 * **One game reads as one game.** The API returns one row per participant (§1), so five of ours in a
 * Flex game is five rows sharing a `matchId`; the page draws one header per game and the players
 * beneath it, which is the difference between "one game, five of us" and "five games".
 *
 * Every rule that could quietly lie lives in `lib/matches/games-view.ts` and is unit-tested there:
 * `–` instead of `0/0/0`, `3/5` instead of `5/10`, the team's clock, and a label (not a guess) for
 * whoever was in the lane. This component arranges, it does not decide.
 */
export function GamesPage() {
  const { slug = '' } = useParams()
  const [scope, setScope] = useState<MatchScope>('all')
  const games = useGames(slug, scope)

  const rows = games.data?.pages.flatMap((page) => page.games) ?? []
  const groups = groupByMatch(rows)

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <Title order={2}>Games</Title>
        <SegmentedControl
          size="xs"
          value={scope}
          onChange={(value) => setScope(value as MatchScope)}
          data={GAMES_SCOPE_OPTIONS.map((option) => ({ ...option }))}
        />
      </Group>

      {games.isPending ? <Loader size="sm" /> : null}
      {games.isError ? <Text c="red">{messageOf(games.error)}</Text> : null}

      {!games.isPending && !games.isError && groups.length === 0 ? (
        <Text c="dimmed">
          No games in this filter yet. The sync runs hourly; a scrim can be entered by hand.
        </Text>
      ) : null}

      {groups.map((group) => {
        const first = group.rows[0]
        if (!first) return null
        return (
          <Paper key={group.matchId} withBorder p="xs">
            <Group gap="xs" mb={6} wrap="wrap">
              {/* the instant is the same for every row of the game, so it is said once */}
              <Text size="sm" fw={600}>
                {formatGameTime(first.gameStartAt)}
              </Text>
              <Badge size="sm" variant="light">
                {kindLabel(first.kind)}
              </Badge>
              {/* provenance per game: a league game nobody ingested must not look like one that never happened */}
              <Badge size="sm" variant="outline" color="gray">
                {provenanceLabel(first.provenance)}
              </Badge>
              {first.isRemake ? (
                <Badge size="sm" color="yellow" variant="light">
                  Remake
                </Badge>
              ) : null}
            </Group>

            <Table.ScrollContainer minWidth={820}>
              <Table striped highlightOnHover withTableBorder fz="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Player</Table.Th>
                    <Table.Th>Champion</Table.Th>
                    <Table.Th>Role</Table.Th>
                    <Table.Th>W/L</Table.Th>
                    <Table.Th>KDA</Table.Th>
                    <Table.Th>Team</Table.Th>
                    <Table.Th>Partner</Table.Th>
                    <Table.Th>Lane opponent</Table.Th>
                    <Table.Th>Opponent partner</Table.Th>
                    <Table.Th>Note</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {group.rows.map((row) => (
                    <GameRow
                      key={`${row.matchId}:${row.player.userId ?? row.player.account ?? 'x'}:${row.championId ?? 'x'}`}
                      row={row}
                    />
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Paper>
        )
      })}

      {games.hasNextPage ? (
        <Button
          variant="light"
          loading={games.isFetchingNextPage}
          onClick={() => void games.fetchNextPage()}
        >
          Load more
        </Button>
      ) : null}
    </Stack>
  )
}

function GameRow({ row }: { row: MatchGameDto }) {
  return (
    <Table.Tr>
      <Table.Td>
        <Stack gap={0}>
          <Text size="sm">{row.player.displayName ?? 'Unknown'}</Text>
          {/* which account, because one member may have several */}
          <Text size="xs" c="dimmed">
            {row.player.account ?? '–'}
          </Text>
        </Stack>
      </Table.Td>
      <Table.Td>
        {row.championId === null ? (
          <Text size="sm">–</Text>
        ) : (
          <Group gap={6} wrap="nowrap">
            <ChampionIcon championId={row.championId} size={22} />
            <ChampionLabel championId={row.championId} size={14} />
          </Group>
        )}
      </Table.Td>
      <Table.Td>{row.role ? ROLE_LABELS[row.role] : '–'}</Table.Td>
      <Table.Td>
        {/* one semantic token per outcome, so a palette change is one edit, not a search */}
        <Text c={resultTone(row.win)}>{resultText(row.win)}</Text>
      </Table.Td>
      <Table.Td>{formatKda(row)}</Table.Td>
      <Table.Td>{teamCountText(row.teamCount)}</Table.Td>
      <Table.Td>{laneLabel(row.lane.partner)}</Table.Td>
      <Table.Td>{laneLabel(row.lane.laneOpponent)}</Table.Td>
      <Table.Td>{laneLabel(row.lane.opponentPartner)}</Table.Td>
      <Table.Td>
        <Text size="sm" c="dimmed">
          {row.note ?? '–'}
        </Text>
      </Table.Td>
    </Table.Tr>
  )
}
