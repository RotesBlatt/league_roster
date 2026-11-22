import { beforeEach, describe, expect, test } from 'bun:test'
import type { Me, RosterEntryDto } from '@lol/api/schema-types'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { apiState, installApiMock, resetApiState } from '../api-mock.ts'

/**
 * The roster page renders the **join**: the captain's entry (note, active, override) plus what the
 * player owns (name, main account). Nothing on this page can rename a player — that is the point
 * of the split, and the page must not offer a field the API would refuse.
 */
installApiMock()

const { RosterPage } = await import('../../src/pages/RosterPage.tsx')

const me = (role: Me['role'] = 'captain'): Me => ({
  id: 'u1',
  name: 'Captain',
  email: 'c@test.local',
  image: null,
  teamId: 't1',
  teamSlug: 'alpha',
  role,
  status: 'active',
})

const rows: RosterEntryDto[] = [
  {
    id: 'e1',
    userId: 'u1',
    displayName: 'Jules',
    role: 'MID',
    note: 'shotcaller',
    isActive: true,
    account: {
      id: 'acc-1',
      gameName: 'Hide on bush',
      tagLine: 'EUW',
      verifiedAt: null,
      isMain: true,
      ranks: { solo: null, flex: null },
    },
  },
  {
    id: 'e2',
    userId: 'u2',
    displayName: 'No Profile',
    role: null,
    note: null,
    isActive: false,
    account: null,
  },
]

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MantineProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/t/alpha/roster']}>
          <Routes>
            <Route path="/t/:slug/roster" element={<RosterPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  )
}

beforeEach(() => {
  resetApiState()
  apiState.me = { data: me(), error: null, status: 200 }
  apiState.rosterList = { data: rows, error: null, status: 200 }
  apiState.memberList = { data: [], error: null, status: 200 }
})

const jules = {
  id: 'u1',
  name: 'Jules',
  email: 'j@test.local',
  image: null,
  role: 'member' as const,
  status: 'active' as const,
  createdAt: 0,
  hasRosterEntry: true,
  teamId: 't1',
  accounts: [{ id: 'acc-1', gameName: 'Hide on bush', tagLine: 'EUW', isMain: true }],
}

describe('RosterPage', () => {
  test('renders what the player owns and what the captain owns, in one row', async () => {
    renderPage()

    expect(await screen.findByText('Jules')).toBeDefined()
    // the main account, with its honest state: typed in, never checked against Riot
    expect(screen.getByText('Hide on bush#EUW')).toBeDefined()
    expect(screen.getByText('unverified')).toBeDefined()
    // the captain's note, and a member with no stated position
    expect(screen.getByText('shotcaller')).toBeDefined()
    expect(screen.getByText('unassigned')).toBeDefined()
  })

  test('a captain gets the member picker, not a free-text form', async () => {
    renderPage()

    expect(await screen.findByRole('button', { name: /Add from team/i })).toBeDefined()
    // the old form's fields are gone: a captain cannot type a name or a Riot ID here
    expect(screen.queryByPlaceholderText('Hide on bush')).toBeNull()
  })

  test('removing asks first, and sends nothing until you confirm', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /Remove Jules/ }))

    // the dialog names the player and promises the profile stays untouched
    expect(await screen.findByText(/will be removed from this team/)).toBeDefined()
    expect(apiState.sentRosterPatch).toBeUndefined()

    fireEvent.click(screen.getByRole('button', { name: 'Remove from roster' }))

    await waitFor(() => expect(apiState.sentRosterPatch).toEqual({ id: 'e1' }))
  })

  test('the pencil opens the entry, and saving sends the account chosen for this team', async () => {
    apiState.memberList = { data: [jules], error: null, status: 200 }
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /Edit Jules/ }))
    expect(await screen.findByText('Edit roster entry')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(apiState.sentRosterPatch).toMatchObject({
        id: 'e1',
        body: { accountId: 'acc-1', note: 'shotcaller', roleOverride: 'MID', isActive: true },
      }),
    )
  })

  test('a plain member sees the roster but no write controls', async () => {
    apiState.me = { data: me('member'), error: null, status: 200 }
    renderPage()

    expect(await screen.findByText('Jules')).toBeDefined()
    expect(screen.queryByRole('button', { name: /Add from team/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Remove/i })).toBeNull()
  })
})

describe('ranks on the roster', () => {
  test('a row shows the ranks of the account this team uses, queue included', async () => {
    const ranked: RosterEntryDto = {
      id: 'e1',
      userId: 'u1',
      displayName: 'Jules',
      role: 'MID',
      note: null,
      isActive: true,
      account: {
        id: 'acc-1',
        gameName: 'Hide on bush',
        tagLine: 'EUW',
        verifiedAt: 1,
        isMain: true,
        ranks: {
          solo: { tier: 'GOLD', division: 'II' },
          flex: { tier: 'SILVER', division: 'IV' },
        },
      },
    }

    apiState.rosterList = { data: [ranked], error: null, status: 200 }
    renderPage()

    expect(await screen.findByText('Solo Gold II')).toBeTruthy()
    expect(screen.getByText('Flex Silver IV')).toBeTruthy()
  })

  test('an account without ranks shows none — the badge row stays empty', async () => {
    renderPage()

    // rows[0] is unverified and unranked: the label is there, no rank badge is invented
    expect(await screen.findByText('Hide on bush#EUW')).toBeTruthy()
    expect(screen.queryByText(/Solo |Flex /)).toBeNull()
  })
})
