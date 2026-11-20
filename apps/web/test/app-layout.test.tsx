import { describe, expect, mock, test } from 'bun:test'
import type { Me } from '@lol/api/schema-types'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { installApiMock } from './api-mock.ts'

/**
 * Regression: the header's links used to be built from `me.teamSlug`, which `/api/me` pins to
 * the *oldest* membership — so switching team changed the page but every nav link pointed back
 * at the old team. Links must follow the slug in the URL.
 *
 * The real `TeamSwitcher` renders here (stubbing it would clobber team-switcher.test.tsx, since
 * `mock.module` is process-wide); only the network edge is mocked, from api-mock.ts.
 */

installApiMock()

mock.module('../src/auth-client.ts', () => ({
  signOut: async () => {},
}))

const { AppLayout } = await import('../src/components/AppLayout.tsx')

// the account's oldest team is alpha, and it is what /api/me reports
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

function renderAt(pathname: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[pathname]}>
          <Routes>
            <Route path="/t/:slug" element={<AppLayout me={me} />}>
              <Route path="roster" element={<div>roster body</div>} />
              <Route path="admin" element={<div>admin body</div>} />
            </Route>
            <Route path="/new-team" element={<AppLayout me={me} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  )
}

const hrefOf = (name: RegExp) => screen.getByRole('link', { name }).getAttribute('href')

describe('AppLayout navigation', () => {
  test('links stay in the team the URL names, not the oldest membership', () => {
    renderAt('/t/bravo/roster')

    expect(hrefOf(/Roster/)).toBe('/t/bravo/roster')
    expect(hrefOf(/Admin/)).toBe('/t/bravo/admin')
  })

  test('one more hop keeps the team: the next page does not drift back', () => {
    renderAt('/t/bravo/admin')

    expect(hrefOf(/Roster/)).toBe('/t/bravo/roster')
    expect(hrefOf(/Admin/)).toBe('/t/bravo/admin')
  })

  test('outside /t/:slug the links fall back to the account’s team', () => {
    // /new-team has no slug in the path, so there is nothing better to offer than me.teamSlug
    renderAt('/new-team')

    expect(hrefOf(/Roster/)).toBe('/t/alpha/roster')
  })
})
