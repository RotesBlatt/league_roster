import { beforeEach, describe, expect, setSystemTime, test } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { apiState, installApiMock, resetApiState } from '../api-mock.ts'

/**
 * How stale a champion payload may be in an open tab.
 *
 * The rule being pinned: a patch lands every ~2 weeks, but a member who leaves the app open should
 * not keep rendering yesterday's names for a whole session. The window is minutes, not hours — and
 * a remount inside it must cost no request, because the header chip and every champion render read
 * this one query.
 *
 * `gcTime: Infinity` on the test client is load-bearing: with the default five minutes, the entry
 * would be garbage-collected between the two renders and the second fetch would prove nothing
 * about staleness.
 */
installApiMock()

const { useChampions } = await import('../../src/api/hooks.ts')

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
}

function freshClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
  })
}

const START = new Date('2026-11-25T10:00:00.000Z')
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000)

beforeEach(() => {
  resetApiState()
  apiState.champions = {
    data: {
      patch: '16.23.1',
      previousPatch: '16.22.1',
      patchPublishedAt: 1_795_113_623_358,
      fetchedAt: 1_795_113_900_000,
      state: 'current',
      champions: [],
    },
    error: null,
    status: 200,
  }
  setSystemTime(START)
})

describe('useChampions staleness', () => {
  test('a remount minutes later reuses the payload — the cache is doing its job', async () => {
    const client = freshClient()

    const first = renderHook(() => useChampions(), { wrapper: wrapper(client) })
    await waitFor(() => expect(apiState.calls.championsGet).toBe(1))
    first.unmount()

    setSystemTime(at(4))
    const second = renderHook(() => useChampions(), { wrapper: wrapper(client) })
    await waitFor(() => expect(second.result.current.data).toBeDefined())

    expect(apiState.calls.championsGet).toBe(1)
  })

  test('after the window the next mount asks the server again, so patch day lands', async () => {
    const client = freshClient()

    const first = renderHook(() => useChampions(), { wrapper: wrapper(client) })
    await waitFor(() => expect(apiState.calls.championsGet).toBe(1))
    first.unmount()

    setSystemTime(at(6))
    renderHook(() => useChampions(), { wrapper: wrapper(client) })

    await waitFor(() => expect(apiState.calls.championsGet).toBe(2))
  })
})
