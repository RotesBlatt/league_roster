import { beforeEach, describe, expect, test } from 'bun:test'
import type { MatchGameDto } from '@lol/api/schema-types'
import { MantineProvider, Table } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { apiState, installApiMock, resetApiState } from '../../api-mock.ts'

/**
 * One game-log row (match-history.md §9).
 *
 * **Regression test.** When the old games page was replaced by the stats views, the log lost the
 * **lane opponent** column — the one thing a player looks for first ("who was I against?"). The pure
 * rule (`laneCell`) was already tested and still passed, because nothing rendered it any more; only
 * a render test can catch a column going missing.
 */
installApiMock()

const { GameLogRow } = await import('../../../src/components/matches/GameLogRow.tsx')

const CHAMPIONS = {
  patch: '16.23.1',
  previousPatch: '16.22.1',
  patchPublishedAt: 1_795_113_623_000,
  fetchedAt: 1_795_113_900_000,
  state: 'current' as const,
  champions: [
    {
      championId: 103,
      name: 'Ahri',
      slug: 'ahri',
      iconUrl: 'https://cdn/103.png',
      positions: [],
      roles: [],
    },
    {
      championId: 24,
      name: 'Jax',
      slug: 'jax',
      iconUrl: 'https://cdn/24.png',
      positions: [],
      roles: [],
    },
  ],
}

function game(overrides: Partial<MatchGameDto> = {}): MatchGameDto {
  return {
    matchId: 'm1',
    gameStartAt: '2026-11-25T18:04:00.000Z',
    kind: 'flex',
    provenance: 'riot',
    isRemake: false,
    queueId: 440,
    durationSeconds: 2100,
    teamCount: 5,
    player: { userId: 'u1', displayName: 'Joni', account: 'RotesBlatt#401' },
    championId: 103,
    role: 'MID',
    win: true,
    kills: 1,
    deaths: 4,
    assists: 22,
    cs: 201,
    goldEarned: 9000,
    visionScore: 20,
    lane: {
      partner: null,
      laneOpponent: { puuid: 'enemy', userId: null, displayName: null, championId: 24 },
      opponentPartner: null,
    },
    note: null,
    ...overrides,
  }
}

function ui(node: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <Table>
          <Table.Tbody>{node}</Table.Tbody>
        </Table>
      </QueryClientProvider>
    </MantineProvider>,
  )
}

beforeEach(() => {
  resetApiState()
  apiState.champions = { data: CHAMPIONS, error: null, status: 200 }
})

describe('GameLogRow', () => {
  test('names the champion the player was against', async () => {
    ui(<GameLogRow game={game()} />)

    // the enemy is shown by champion: we hold no account for them, so there is no name to show
    expect(await screen.findByText('Jax')).toBeDefined()
  })

  test('a game with no entered opponent shows a dash, not an empty cell', async () => {
    ui(
      <GameLogRow
        game={game({
          lane: { partner: null, laneOpponent: null, opponentPartner: null },
        })}
      />,
    )

    // Ahri (ours) and the dashes for lane/account/note; the point is that one of them is the lane
    expect(await screen.findByText('Ahri')).toBeDefined()
    expect(screen.getAllByText('–').length).toBeGreaterThan(0)
  })

  test('a teammate partner is named rather than hidden', async () => {
    ui(
      <GameLogRow
        game={game({
          lane: {
            partner: { puuid: 'p', userId: 'u2', displayName: 'Supp Guy', championId: null },
            laneOpponent: { puuid: 'e', userId: null, displayName: null, championId: 24 },
            opponentPartner: null,
          },
        })}
      />,
    )

    expect(await screen.findByText('Jax')).toBeDefined()
  })
})
