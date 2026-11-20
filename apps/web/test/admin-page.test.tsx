import { beforeEach, describe, expect, test } from 'bun:test'
import type { Me, TeamSummary } from '@lol/api/schema-types'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router'
import { apiState, installApiMock, resetApiState } from './api-mock.ts'

/**
 * The admin page as a whole: which team decides captaincy, and where a save leaves you.
 * Report: renaming threw the captain into the roster instead of keeping them on the page.
 */

installApiMock()

const { AdminPage } = await import('../src/pages/AdminPage.tsx')

const alpha: TeamSummary = {
  id: 'id-alpha',
  slug: 'alpha',
  name: 'Alpha',
  shortName: 'AL',
  role: 'captain',
}

const me: Me = {
  id: 'u1',
  name: 'Julius',
  email: 'j@test.local',
  image: null,
  teamId: alpha.id,
  teamSlug: 'alpha',
  role: 'captain',
  status: 'active',
}

/** Prints the URL, so "where did the save leave me?" is an assertion, not a guess. */
function LocationProbe() {
  return <div>at {useLocation().pathname}</div>
}

function RosterProbe() {
  const { slug } = useParams()
  return <div>roster of {slug}</div>
}

function renderAdmin(entry = '/t/alpha/admin') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[entry]}>
          <LocationProbe />
          <Routes>
            <Route path="/t/:slug/admin" element={<AdminPage />} />
            <Route path="/t/:slug/roster" element={<RosterProbe />} />
            <Route path="*" element={<div>fell through</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  )
}

const saveButton = () => screen.getByRole('button', { name: /save/i })

beforeEach(() => {
  resetApiState()
  apiState.me = { data: me, error: null, status: 200 }
  apiState.teamList = { data: [alpha], error: null, status: 200 }
})

describe('AdminPage', () => {
  test('a save that changes the slug keeps the captain on the admin page', async () => {
    apiState.renameTeam = {
      data: { id: alpha.id, slug: 'neue-welle', name: 'Neue Welle', shortName: 'AL' },
      error: null,
      status: 200,
    }
    renderAdmin()

    fireEvent.change(await screen.findByLabelText('Team name'), {
      target: { value: 'Neue Welle' },
    })
    fireEvent.click(saveButton())

    expect(await screen.findByText('at /t/neue-welle/admin')).toBeDefined()
    expect(screen.queryByText(/roster of/)).toBeNull()
  })

  // the bug behind this test: captaincy came from `GET /api/me`, which names the *oldest*
  // membership — so a captain whose oldest team was another one was redirected away here
  test('a captain of the team in the URL sees the page, even when /api/me names another', async () => {
    apiState.me = {
      data: { ...me, teamId: 'id-older', teamSlug: 'older', role: 'member' },
      error: null,
      status: 200,
    }
    apiState.teamList = {
      data: [alpha, { ...alpha, id: 'id-older', slug: 'older', name: 'Older', role: 'member' }],
      error: null,
      status: 200,
    }
    renderAdmin()

    expect(await screen.findByText('at /t/alpha/admin')).toBeDefined()
    expect(await screen.findByLabelText('Team name')).toBeDefined()
    expect(screen.queryByText(/roster of/)).toBeNull()
  })

  test('a plain member is not left on the page', async () => {
    apiState.me = { data: { ...me, role: 'member' }, error: null, status: 200 }
    apiState.teamList = { data: [{ ...alpha, role: 'member' }], error: null, status: 200 }
    renderAdmin()

    expect(await screen.findByText(/roster of|fell through/)).toBeDefined()
    expect(nameFieldOrNull()).toBeNull()
  })
})

function nameFieldOrNull() {
  return screen.queryByLabelText('Team name')
}
