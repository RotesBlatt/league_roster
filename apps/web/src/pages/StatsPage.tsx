import { ROLE_LABELS } from '@lol/shared'
import { Group, Loader, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { Link, useParams } from 'react-router'
import { useTeamStats } from '../api/hooks.ts'
import { messageOf } from '../api/result.ts'
import { ChampionStatsTable } from '../components/matches/ChampionStatsTable.tsx'
import { formatStatsDate, formatWinrate, formatWinsLosses } from '../lib/matches/stats-view.ts'

/**
 * The team's season at a glance (match-history.md §9): one column per player, each with the four
 * numbers of the target screenshot and the champions they actually played.
 *
 * **No scope selector.** All games count — SoloQ, Flex, Ranked 5v5, scrims and tournaments together —
 * because that is the product decision: this page answers "how is *this person* doing", and a filter
 * that silently excluded a third of their games would answer a different question.
 *
 * Player columns follow the roster order the API returns (role first), so the page does not reshuffle
 * when someone plays a game.
 */
export function StatsPage() {
  const { slug = '' } = useParams()
  const stats = useTeamStats(slug)

  if (stats.isPending) return <Loader size="sm" />
  if (stats.isError) return <Text c="red">{messageOf(stats.error)}</Text>

  const players = stats.data?.players ?? []
  const games = players.reduce((sum, player) => sum + player.games, 0)
  const wins = players.reduce((sum, player) => sum + player.wins, 0)
  const lastPlayed = players
    .map((player) => player.lastPlayedAt)
    .filter((value): value is string => value !== null)
    .sort((a, b) => a.localeCompare(b))
    .at(-1)

  return (
    <Stack gap="lg">
      <Title order={2}>Stats</Title>

      {/* team totals: the same four numbers, summed over the columns below */}
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        <Kpi label="Games" value={String(games)} />
        <Kpi
          label="Winrate"
          value={formatWinrate(games === 0 ? null : Math.round((wins / games) * 100))}
        />
        <Kpi label="W / L" value={formatWinsLosses(wins, games - wins)} />
        <Kpi label="Last played" value={formatStatsDate(lastPlayed)} />
      </SimpleGrid>

      {players.length === 0 ? <Text c="dimmed">No members yet.</Text> : null}

      <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="md">
        {players.map((player) => (
          <Paper key={player.userId} withBorder p="sm">
            <Group justify="space-between" align="baseline" mb={6} wrap="wrap">
              <Group gap={6} align="baseline">
                <Text fw={700} size="sm">
                  {player.role ? ROLE_LABELS[player.role] : '–'}
                </Text>
                <Link to={`/t/${slug}/stats/${player.userId}`}>
                  <Text size="sm" c="brand.4">
                    {player.displayName}
                  </Text>
                </Link>
              </Group>
              <Text size="xs" c="dimmed">
                {player.games} games · {formatWinrate(player.winrate)} winrate
              </Text>
            </Group>

            <ChampionStatsTable champions={player.champions} compact />
          </Paper>
        ))}
      </SimpleGrid>
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
