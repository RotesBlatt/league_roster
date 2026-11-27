import { ROLE_LABELS } from '@lol/shared'
import { Button, Group, Loader, Paper, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core'
import { IconPlus } from '@tabler/icons-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { usePlayerGames, useTeamStats } from '../api/hooks.ts'
import { messageOf } from '../api/result.ts'
import { ChampionStatsTable } from '../components/matches/ChampionStatsTable.tsx'
import { GameLogRow } from '../components/matches/GameLogRow.tsx'
import { ManualMatchForm } from '../components/matches/ManualMatchForm.tsx'
import { formatWinrate, playerKpis } from '../lib/matches/stats-view.ts'

/**
 * One player's season (match-history.md §9) — the target screenshot.
 *
 * Left: the four KPIs and the champions they played. Right: **their** game log, newest first. The
 * log is the same games endpoint with `player` set, so a teammate who was in the same match does not
 * appear here.
 *
 * The player is read from the team stats query rather than a second endpoint: the page already needs
 * the champion table, and one request that answers both is one request fewer on a page a captain
 * opens on a second screen during champ select.
 */
export function PlayerStatsPage() {
  const { slug = '', userId = '' } = useParams()
  const stats = useTeamStats(slug)
  const games = usePlayerGames(slug, userId)
  const [formOpen, setFormOpen] = useState(false)

  if (stats.isPending) return <Loader size="sm" />
  if (stats.isError) return <Text c="red">{messageOf(stats.error)}</Text>

  const player = (stats.data?.players ?? []).find((entry) => entry.userId === userId)
  if (!player) {
    return (
      <Stack gap="sm">
        <Text c="dimmed">This person is not a member of the team.</Text>
        <Link to={`/t/${slug}/stats`}>Back to the team stats</Link>
      </Stack>
    )
  }

  const kpis = playerKpis(player)
  const rows = games.data?.pages.flatMap((page) => page.games) ?? []

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="baseline" wrap="wrap">
        <Group gap="sm" align="baseline">
          <Title order={2}>{player.displayName}</Title>
          <Text size="sm" c="dimmed">
            {player.role ? ROLE_LABELS[player.role] : 'no role'} ·{' '}
            <Link to={`/t/${slug}/stats`}>team stats</Link>
          </Text>
        </Group>
        {/* the games Riot cannot see: a scrim entered by hand, in the same table as the rest */}
        <Button
          size="xs"
          variant="light"
          leftSection={<IconPlus size={14} />}
          onClick={() => setFormOpen(true)}
        >
          Enter a game
        </Button>
      </Group>

      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        <Kpi label="Games" value={kpis.games} />
        <Kpi label="Winrate" value={kpis.winrate} />
        <Kpi label="W / L" value={kpis.record} />
        <Kpi label="Last played" value={kpis.lastPlayed} />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <Paper withBorder p="sm">
          <Text fw={700} size="sm" mb={6}>
            Champions · {player.games} games · {formatWinrate(player.winrate)} winrate
          </Text>
          <ChampionStatsTable champions={player.champions} />
        </Paper>

        <Paper withBorder p="sm">
          <Text fw={700} size="sm" mb={6}>
            Game log · newest first
          </Text>

          {games.isPending ? <Loader size="xs" /> : null}
          {games.isError ? <Text c="red">{messageOf(games.error)}</Text> : null}
          {!games.isPending && rows.length === 0 ? (
            <Text size="sm" c="dimmed">
              No games yet. The sync runs hourly; a scrim can be entered by hand.
            </Text>
          ) : null}

          {rows.length > 0 ? (
            <Table.ScrollContainer minWidth={620}>
              <Table fz="sm" verticalSpacing={4} highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Date</Table.Th>
                    <Table.Th>Type</Table.Th>
                    <Table.Th>Champion</Table.Th>
                    <Table.Th>W/L</Table.Th>
                    <Table.Th>Stats</Table.Th>
                    {/* the champion you were against: the first thing a reader looks for (§7) */}
                    <Table.Th>Opponent</Table.Th>
                    <Table.Th>Account</Table.Th>
                    <Table.Th>Note</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((game) => (
                    <GameLogRow key={`${game.matchId}:${game.championId ?? 'x'}`} game={game} />
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          ) : null}

          {games.hasNextPage ? (
            <Button
              mt="sm"
              size="xs"
              variant="subtle"
              loading={games.isFetchingNextPage}
              onClick={() => void games.fetchNextPage()}
            >
              Load more
            </Button>
          ) : null}
        </Paper>
      </SimpleGrid>

      <ManualMatchForm opened={formOpen} onClose={() => setFormOpen(false)} slug={slug} />
    </Stack>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Paper withBorder p="sm">
      <Text size="xs" c="dimmed" tt="uppercase">
        {label}
      </Text>
      <Text fz={22} fw={700}>
        {value}
      </Text>
    </Paper>
  )
}
