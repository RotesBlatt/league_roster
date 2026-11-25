import { beforeEach, describe, expect, test } from 'bun:test'
import type { Me, TeamDto, TeamSummary } from '@lol/api/schema-types'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { apiState, installApiMock, resetApiState } from '../../api-mock.ts'
import { installAuthMock } from '../../auth-mock.ts'

/**
 * The rename, seen from the shell. `team-settings-card.test.tsx` proves the card's rule in
 * isolation — render it alone and it navigates correctly — so a rename that leaves the header on
 * the old slug can only be a disagreement between the card, the `['teams']` cache the switcher
 * reads, and the URL. That is exactly what a card-only test cannot see, and what was broken:
 * after the slug moved, the switcher printed the raw slug and the URL did not move.
 */

installApiMock()
installAuthMock()

const { AppLayout } = await import('../../../src/components/AppLayout.tsx')
const { AdminPage } = await import('../../../src/pages/AdminPage.tsx')

// the account's oldest team — what /api/me reports
const me: Me = {
  id: 'u1',
  name: 'Julius',
  email: 'j@test.local',
  image: null,
  teamId: 'id-alpha',
  teamSlug: 'alpha',
  role: 'captain',
  status: 'active',
}

const alpha: TeamSummary = {
  id: 'id-alpha',
  slug: 'alpha',
  name: 'Alpha',
  shortName: 'AL',
  role: 'captain',
}

const renamed: TeamDto = {
  id: 'id-alpha',
  slug: 'bravo-squad',
  name: 'Bravo Squad',
  shortName: 'BS',
}

function PathProbe() {
  return <div data-testid="path">{useLocation().pathname}</div>
}

function renderShell() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/t/alpha/admin']}>
          <Routes>
            <Route path="/t/:slug" element={<AppLayout me={me} />}>
              <Route path="admin" element={<AdminPage />} />
              <Route path="roster" element={<div>roster body</div>} />
            </Route>
          </Routes>
          <PathProbe />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  )
}

beforeEach(() => {
  resetApiState()
  apiState.me = { data: me, error: null, status: 200 }
  apiState.teamList = { data: [alpha], error: null, status: 200 }
  apiState.inviteList = { data: [], error: null, status: 200 }
  apiState.memberList = { data: [], error: null, status: 200 }
})

describe('renaming from the admin page', () => {
  test('the shell follows the new slug and shows the new name', async () => {
    renderShell()

    const nameField = (await screen.findByLabelText('Team name')) as HTMLInputElement
    fireEvent.change(nameField, { target: { value: renamed.name } })

    // from the click onward the server *has* the rename: the PATCH answer and the team list agree
    apiState.renameTeam = { data: renamed, error: null, status: 200 }
    apiState.teamList = { data: [{ ...alpha, ...renamed }], error: null, status: 200 }

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    // the name a human reads, never the slug (`bravo-squad` would fail this)
    expect(await screen.findByRole('button', { name: /Bravo Squad/ })).toBeDefined()
    // and the URL moved with it, so the links and the next load agree
    expect(screen.getByTestId('path').textContent).toBe('/t/bravo-squad/admin')
  })
})
