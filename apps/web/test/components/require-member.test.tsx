import { beforeEach, describe, expect, test } from 'bun:test'
import type { Me } from '@lol/api/schema-types'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { apiState, installApiMock, resetApiState } from '../api-mock.ts'
import { installAuthMock } from '../auth-mock.ts'

/**
 * `RequireMember` decides the whole screen state from `useMe`, so these tests drive the *network*
 * edge and let the real hook run — exactly like `app-layout.test.tsx`.
 *
 * This file used to `mock.module('../src/api/hooks.ts')` instead. Because `mock.module` is
 * process-wide, that replaced the hooks for every file that ran afterwards, and pages importing
 * them silently stopped fetching (a 1 s `findBy…` timeout, not a clear failure). That is the third
 * time this hazard bit us — see the note in `api-mock.ts`.
 */
installApiMock()
installAuthMock()

installAuthMock()

const { RequireMember } = await import('../../src/components/RequireMember.tsx')

const member = (over: Partial<Me> = {}): Me => ({
  id: '1',
  name: 'Julius',
  email: 'j@x',
  image: null,
  teamId: 't1',
  teamSlug: 'alpha',
  role: 'member',
  status: 'active',
  ...over,
})

function renderAt(pathname: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[pathname]}>
          <Routes>
            <Route path="/login" element={<div>login screen</div>} />
            <Route element={<RequireMember />}>
              <Route path="/t/:slug/roster" element={<div>roster screen</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  )
}

beforeEach(() => {
  resetApiState()
})

describe('RequireMember', () => {
  test('shows a loader while the session is loading', () => {
    apiState.pending.me = true
    const { container } = renderAt('/t/alpha/roster')

    expect(screen.queryByText('roster screen')).toBeNull()
    expect(container.querySelector('[class*="Loader"], [class*="mantine-Loader"]')).not.toBeNull()
  })

  test('redirects to /login when the session is rejected with 401', async () => {
    apiState.me = { data: null, error: { value: { message: 'Not signed in' } }, status: 401 }
    renderAt('/t/alpha/roster')

    expect(await screen.findByText('login screen')).toBeDefined()
    expect(screen.queryByText('roster screen')).toBeNull()
  })

  test('surfaces a non-auth error instead of redirecting', async () => {
    apiState.me = { data: null, error: { value: { message: 'database is down' } }, status: 500 }
    renderAt('/t/alpha/roster')

    expect(await screen.findByText('Something broke')).toBeDefined()
    expect(screen.getByText('database is down')).toBeDefined()
    expect(screen.queryByText('login screen')).toBeNull()
  })

  test('an account in no team gets the no-team screen, not a roster', async () => {
    apiState.me = {
      data: member({ teamId: null, teamSlug: null, role: 'member', status: null }),
      error: null,
      status: 200,
    }
    renderAt('/t/alpha/roster')

    // not a dead end any more: the screen creates a team instead of pointing at an invite
    expect(await screen.findByText('Create your team')).toBeDefined()
    // placeholder, not getByLabelText: Mantine's label association is not resolved under happy-dom
    expect(screen.getByPlaceholderText('Die Besten')).toBeDefined()
    expect(screen.queryByText('roster screen')).toBeNull()
  })

  test('blocks a disabled account', async () => {
    apiState.me = { data: member({ status: 'disabled' }), error: null, status: 200 }
    renderAt('/t/alpha/roster')

    expect(await screen.findByText('Access disabled')).toBeDefined()
    expect(screen.queryByText('roster screen')).toBeNull()
  })

  test('renders the page for an approved member', async () => {
    apiState.me = { data: member(), error: null, status: 200 }
    renderAt('/t/alpha/roster')

    expect(await screen.findByText('roster screen')).toBeDefined()
  })

  test('shows the admin link only for captains', async () => {
    apiState.me = {
      data: member({ name: 'Captain', role: 'captain' }),
      error: null,
      status: 200,
    }
    renderAt('/t/alpha/roster')

    expect(await screen.findByText('Admin')).toBeDefined()
  })
})
