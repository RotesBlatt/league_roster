import { beforeEach, describe, expect, test } from 'bun:test'
import type { Me, TeamSummary } from '@lol/api/schema-types'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { apiState, installApiMock, resetApiState } from './api-mock.ts'

/**
 * The switcher's wiring: what the header names, that the menu only offers *other* teams, and
 * that picking one lands on its roster. `team-menu.test.ts` covers the derived state itself.
 *
 * `api.ts` comes from the shared mock in api-mock.ts: bun's `mock.module` is process-wide,
 * so per-file factories clobber each other.
 */

const alpha: TeamSummary = {
  id: 'id-alpha',
  slug: 'alpha',
  name: 'Alpha',
  shortName: 'AL',
  role: 'captain',
}
const bravo: TeamSummary = {
  id: 'id-bravo',
  slug: 'bravo',
  name: 'Bravo',
  shortName: null,
  role: 'member',
}

installApiMock()

const { TeamSwitcher } = await import('../src/components/team/TeamSwitcher.tsx')

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

function RosterProbe() {
  const { slug } = useParams()
  return <div>roster of {slug}</div>
}

function AdminProbe() {
  const { slug } = useParams()
  return <div>admin of {slug}</div>
}

function renderSwitcher(entry = '/t/alpha/roster') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route
              path="/t/:slug/roster"
              element={
                <>
                  <TeamSwitcher me={me} />
                  <RosterProbe />
                </>
              }
            />
            <Route
              path="/t/:slug/admin"
              element={
                <>
                  <TeamSwitcher me={me} />
                  <AdminProbe />
                </>
              }
            />
            <Route path="/new-team" element={<div>new team screen</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  )
}

async function openMenu(name: RegExp = /Alpha/) {
  fireEvent.click(await screen.findByRole('button', { name }))
}

const bothTeams = { data: [alpha, bravo], error: null, status: 200 }

beforeEach(() => {
  resetApiState()
  apiState.teamList = bothTeams
})

describe('TeamSwitcher', () => {
  test('names the team in the URL, not the first one in the list', async () => {
    apiState.teamList = { data: [bravo, alpha], error: null, status: 200 }
    renderSwitcher()

    expect(await screen.findByRole('button', { name: /Alpha/ })).toBeDefined()
  })

  test('falls back to the slug while the list has not arrived', async () => {
    apiState.teamList = { data: [], error: null, status: 200 }
    renderSwitcher()

    expect(await screen.findByRole('button', { name: /alpha/ })).toBeDefined()
  })

  test('the menu offers the other teams, and picking one opens its roster', async () => {
    renderSwitcher()

    await openMenu()
    fireEvent.click(await screen.findByText('Bravo'))

    expect(await screen.findByText('roster of bravo')).toBeDefined()
  })

  test('the current team is labelled as such, not offered as a switch target', async () => {
    renderSwitcher()

    await openMenu()
    expect(await screen.findByText('current')).toBeDefined()
    // the label row shows Alpha once; there is no second, clickable "Alpha" item
    expect(screen.queryByText('AL')).toBeNull()
  })

  // regression: the header used to treat `me.teamSlug` (the oldest membership) as current, so
  // after switching, the team you were looking at was offered as "another" team
  test('the team in the URL is current, even when /api/me names another', async () => {
    renderSwitcher('/t/bravo/roster')

    expect(await screen.findByRole('button', { name: /Bravo/ })).toBeDefined()

    await openMenu(/Bravo/)
    fireEvent.click(await screen.findByText('Alpha'))

    expect(await screen.findByText('roster of alpha')).toBeDefined()
  })

  // switching team is a change of tenant, not of page: being sent back to the roster from the
  // admin page is a demotion, and it was what the switcher did
  test('switching from the admin page stays in the admin page', async () => {
    renderSwitcher('/t/alpha/admin')

    await openMenu()
    fireEvent.click(await screen.findByText('Bravo'))

    expect(await screen.findByText('admin of bravo')).toBeDefined()
    expect(screen.queryByText('roster of bravo')).toBeNull()
  })

  test('creating another team leads to /new-team', async () => {
    renderSwitcher()

    await openMenu()
    fireEvent.click(await screen.findByText('Create another team'))

    expect(await screen.findByText('new team screen')).toBeDefined()
  })
})
