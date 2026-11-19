import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { Me, TeamSummary } from '@lol/api/schema-types'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { ApiError, unwrap } from '../src/api-result.ts'

/**
 * The switcher's wiring: what the header names, that the menu only offers *other* teams, and
 * that picking one lands on its roster. `team-menu.test.ts` covers the derived state itself.
 *
 * Mocking `api.ts` (not `hooks.ts`): `mock.module` is process-wide in bun, so a second mock of
 * `hooks.ts` would replace the one `require-member.test.tsx` registered.
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

type Result = { data: unknown; error: unknown; status: number }
let teamsResult: Result = { data: [alpha, bravo], error: null, status: 200 }

mock.module('../src/api.ts', () => ({
  ApiError,
  unwrap,
  api: { teams: { get: () => Promise.resolve(teamsResult) } },
}))

const { TeamSwitcher } = await import('../src/components/TeamSwitcher.tsx')

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

function renderSwitcher() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/t/alpha/roster']}>
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
            <Route path="/new-team" element={<div>new team screen</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  )
}

async function openMenu() {
  const target = await screen.findByRole('button', { name: /Alpha/ })
  fireEvent.click(target)
}

beforeEach(() => {
  teamsResult = { data: [alpha, bravo], error: null, status: 200 }
})

describe('TeamSwitcher', () => {
  test('names the team in the URL, not the first one in the list', async () => {
    teamsResult = { data: [bravo, alpha], error: null, status: 200 }
    renderSwitcher()

    expect(await screen.findByRole('button', { name: /Alpha/ })).toBeDefined()
  })

  test('falls back to the slug while the list has not arrived', async () => {
    teamsResult = { data: [], error: null, status: 200 }
    renderSwitcher()

    expect(await screen.findByRole('button', { name: /alpha/ })).toBeDefined()
  })

  test('the menu offers the other teams, and picking one opens its roster', async () => {
    renderSwitcher()

    await openMenu()
    const bravoItem = await screen.findByText('Bravo')
    fireEvent.click(bravoItem)

    expect(await screen.findByText('roster of bravo')).toBeDefined()
  })

  test('the current team is labelled as such, not offered as a switch target', async () => {
    renderSwitcher()

    await openMenu()
    expect(await screen.findByText('current')).toBeDefined()
    // the label row shows Alpha once; there is no second, clickable "Alpha" item
    expect(screen.queryByText('AL')).toBeNull()
  })

  test('creating another team leads to /new-team', async () => {
    renderSwitcher()

    await openMenu()
    fireEvent.click(await screen.findByText('Create another team'))

    expect(await screen.findByText('new team screen')).toBeDefined()
  })
})
