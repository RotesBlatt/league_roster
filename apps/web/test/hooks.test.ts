import { beforeEach, describe, expect, test } from 'bun:test'
import type { ProfileDto, RiotAccountDto } from '@lol/api/schema-types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { apiState, installApiMock, resetApiState } from './api-mock.ts'

/**
 * The profile hooks. Their only real logic is **cache behaviour** — a save must not need a
 * refetch, and an account change must invalidate the list — so that is what is pinned here.
 * The network edge is the shared `api-mock.ts`, like every other UI test.
 */
installApiMock()

const {
  useAddRiotAccount,
  useAddRosterEntry,
  useProfile,
  useRiotAccounts,
  useRoster,
  useSaveProfile,
} = await import('../src/hooks.ts')

const profile: ProfileDto = {
  displayName: 'Julius',
  preferredRole: 'MID',
  birthday: null,
  updatedAt: 0,
}

const account = (over: Partial<RiotAccountDto> = {}): RiotAccountDto => ({
  id: 'acc-1',
  gameName: 'Hide on bush',
  tagLine: 'EUW',
  platform: 'euw1',
  isMain: true,
  verifiedAt: null,
  fetchedAt: null,
  summonerLevel: null,
  profileIconId: null,
  ranks: { solo: null, flex: null },
  ...over,
})

/** One client per render, so no state leaks between tests. */
function renderWithQuery<T>(hook: () => T) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)

  return { client, ...renderHook(hook, { wrapper }) }
}

beforeEach(() => {
  resetApiState()
})

describe('useProfile', () => {
  test('exposes the profile the API returned', async () => {
    apiState.profile = { data: profile, error: null, status: 200 }

    const { result } = renderWithQuery(() => useProfile())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(profile)
  })

  test('a save seeds the cache: the page does not refetch to show what it just wrote', async () => {
    apiState.profile = { data: profile, error: null, status: 200 }
    apiState.profileSave = {
      data: { ...profile, displayName: 'Jules' },
      error: null,
      status: 200,
    }

    const { result } = renderWithQuery(() => ({ read: useProfile(), save: useSaveProfile() }))

    await waitFor(() => expect(result.current.read.isSuccess).toBe(true))
    const readsBefore = apiState.calls.profileGet

    result.current.save.mutate({
      displayName: 'Jules',
      preferredRole: 'MID',
      birthday: null,
    })

    await waitFor(() => expect(result.current.save.isSuccess).toBe(true))
    expect(apiState.sentProfile).toEqual({
      displayName: 'Jules',
      preferredRole: 'MID',
      birthday: null,
    })
    // the cached read now carries the saved value, and no second GET was made
    expect(apiState.calls.profileGet).toBe(readsBefore)
    await waitFor(() => expect(result.current.read.data?.displayName).toBe('Jules'))
  })
})

describe('useRiotAccounts', () => {
  test('adding an account invalidates the list, so ordering and the main flag come from the server', async () => {
    apiState.riotAccountList = { data: [account()], error: null, status: 200 }
    apiState.riotAccountAdd = {
      data: account({ id: 'acc-2', isMain: false }),
      error: null,
      status: 200,
    }

    const { result } = renderWithQuery(() => ({
      list: useRiotAccounts(),
      add: useAddRiotAccount(),
    }))

    await waitFor(() => expect(result.current.list.isSuccess).toBe(true))
    const readsBefore = apiState.calls.riotAccountsGet

    result.current.add.mutate({ gameName: 'Smurf', tagLine: 'EUW' })

    await waitFor(() => expect(result.current.add.isSuccess).toBe(true))
    expect(apiState.sentAccount).toEqual({ gameName: 'Smurf', tagLine: 'EUW' })
    await waitFor(() => expect(apiState.calls.riotAccountsGet).toBe(readsBefore + 1))
  })
})

describe('useRoster', () => {
  test('reads the team in the URL, and a write refreshes that list', async () => {
    apiState.rosterList = {
      data: [
        {
          id: 'e1',
          userId: 'u1',
          displayName: 'Jules',
          role: 'MID',
          note: null,
          isActive: true,
          mainAccount: null,
        },
      ],
      error: null,
      status: 200,
    }

    const { result } = renderWithQuery(() => ({
      list: useRoster('alpha'),
      add: useAddRosterEntry('alpha'),
    }))

    await waitFor(() => expect(result.current.list.isSuccess).toBe(true))
    const readsBefore = apiState.calls.rosterGet

    result.current.add.mutate({ userId: 'u2', note: 'sub' })

    await waitFor(() => expect(result.current.add.isSuccess).toBe(true))
    expect(apiState.sentRoster).toEqual({ userId: 'u2', note: 'sub' })
    await waitFor(() => expect(apiState.calls.rosterGet).toBe(readsBefore + 1))
  })
})
