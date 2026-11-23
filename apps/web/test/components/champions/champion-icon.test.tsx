import { beforeEach, describe, expect, test } from 'bun:test'
import type { ChampionsDto } from '@lol/api/schema-types'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { apiState, installApiMock, resetApiState } from '../../api-mock.ts'

/**
 * The one reusable way to render a champion anywhere (hexserve-champion-data.md §7, §11 step 4).
 *
 * The property that matters: **no id can make this throw**. A pool cell, a match row and a header
 * chip all pass ids that came from somewhere else, and the dump lags a patch by a day at least —
 * so unknown, loading and empty must all render a placeholder rather than an error.
 */
installApiMock()

const { ChampionIcon, ChampionLabel } = await import(
  '../../../src/components/champions/ChampionIcon.tsx'
)

const SNAPSHOT: ChampionsDto = {
  patch: '16.23.1',
  previousPatch: '16.22.1',
  patchPublishedAt: 1_795_113_623_000,
  fetchedAt: 1_795_113_900_000,
  state: 'current',
  champions: [
    {
      championId: 1,
      name: 'Annie',
      slug: 'annie',
      iconUrl: 'https://cdn/1.png',
      positions: ['MIDDLE'],
      roles: ['MAGE'],
    },
  ],
}

beforeEach(() => {
  resetApiState()
  apiState.champions = { data: SNAPSHOT, error: null, status: 200 }
})

function ui(node: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
    </MantineProvider>,
  )
}

describe('ChampionIcon', () => {
  test('a known id renders the stored icon, labelled with the champion name', async () => {
    ui(<ChampionIcon championId={1} />)

    const image = await screen.findByRole('img', { name: 'Annie' })
    expect(image.getAttribute('src')).toBe('https://cdn/1.png')
  })

  test('an unknown id renders a placeholder with the id, and does not throw', async () => {
    ui(<ChampionIcon championId={9001} />)

    expect(await screen.findByText('#9001')).toBeDefined()
    expect(screen.queryByRole('img')).toBeNull()
  })

  test('an empty cache renders placeholders rather than failing the page', async () => {
    apiState.champions = {
      data: { ...SNAPSHOT, state: 'empty', patch: null, previousPatch: null, champions: [] },
      error: null,
      status: 200,
    }

    ui(<ChampionIcon championId={1} />)

    expect(await screen.findByText('#1')).toBeDefined()
  })

  test('a failed request is still a placeholder — the dump being down is not an error page', async () => {
    apiState.champions = { data: null, error: { message: 'boom', status: 500 }, status: 500 }

    ui(<ChampionIcon championId={1} />)

    expect(await screen.findByText('#1')).toBeDefined()
  })
})

describe('ChampionLabel', () => {
  test('renders icon and name together — what a pool cell or a match row shows', async () => {
    ui(<ChampionLabel championId={1} />)

    expect(await screen.findByText('Annie')).toBeDefined()
    expect(screen.getByRole('img', { name: 'Annie' })).toBeDefined()
  })

  test('an unknown id falls back to the id for the text, never an empty cell', async () => {
    ui(<ChampionLabel championId={9001} />)

    expect(await screen.findByText('Champion #9001')).toBeDefined()
  })
})
