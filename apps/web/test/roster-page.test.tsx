import { beforeEach, describe, expect, test } from 'bun:test'
import type { Me, RosterEntryDto } from '@lol/api/schema-types'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { apiState, installApiMock, resetApiState } from './api-mock.ts'

/**
 * The roster page renders the **join**: the captain's entry (note, active, override) plus what the
 * player owns (name, main account). Nothing on this page can rename a player — that is the point
 * of the split, and the page must not offer a field the API would refuse.
 */
installApiMock()

const { RosterPage } = await import('../src/pages/RosterPage.tsx')

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
    mainAccount: { gameName: 'Hide on bush', tagLine: 'EUW', verifiedAt: null },
  },
  {
    id: 'e2',
    userId: 'u2',
    displayName: 'No Profile',
    role: null,
    note: null,
    isActive: false,
    mainAccount: null,
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

  test('a plain member sees the roster but no write controls', async () => {
    apiState.me = { data: me('member'), error: null, status: 200 }
    renderPage()

    expect(await screen.findByText('Jules')).toBeDefined()
    expect(screen.queryByRole('button', { name: /Add from team/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Remove/i })).toBeNull()
  })
})
