import { beforeEach, describe, expect, test } from 'bun:test'
import type { ChampionsDto } from '@lol/api/schema-types'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { apiState, installApiMock, resetApiState } from '../../api-mock.ts'

/**
 * The header chip (hexserve-champion-data.md §5): which champion set am I looking at, when did the
 * patch land, and is it the newest one. It is the only place a member sees that the dump exists.
 *
 * It must never be the reason the header fails: no data renders nothing, and a failed request is
 * not an error banner.
 */
installApiMock()

const { PatchStatus } = await import('../../../src/components/champions/PatchStatus.tsx')

const SNAPSHOT: ChampionsDto = {
  patch: '16.23.1',
  previousPatch: '16.22.1',
  patchPublishedAt: 1_795_113_623_358,
  fetchedAt: 1_795_113_900_000,
  state: 'current',
  champions: [],
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

describe('PatchStatus', () => {
  test('shows the current patch and the day it was published', async () => {
    ui(<PatchStatus />)

    expect(await screen.findByText(/^Patch 16\.23\.1/)).toBeDefined()
  })

  test('an older patch is visibly marked stale', async () => {
    apiState.champions = {
      data: { ...SNAPSHOT, state: 'previous' },
      error: null,
      status: 200,
    }

    ui(<PatchStatus />)

    expect(await screen.findByText(/stale/)).toBeDefined()
  })

  test('an empty cache says so instead of showing a patch it does not have', async () => {
    apiState.champions = {
      data: { ...SNAPSHOT, patch: null, state: 'empty', patchPublishedAt: null },
      error: null,
      status: 200,
    }

    ui(<PatchStatus />)

    expect(await screen.findByText(/no champion data/i)).toBeDefined()
  })

  test('a failed request renders nothing — the header is not an error surface', async () => {
    apiState.champions = { data: null, error: { message: 'boom', status: 500 }, status: 500 }

    const { container } = ui(<PatchStatus />)

    // Mantine injects style tags into the container, so "renders nothing" is asserted on the
    // badge element, not on textContent
    expect(container.querySelector('[class*="mantine-Badge"]')).toBeNull()
  })
})
