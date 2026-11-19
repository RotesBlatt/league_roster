import { describe, expect, mock, test } from 'bun:test'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'

// `useMe` decides the whole screen state; mocking it keeps this a UI test, not an API test.
let meState: unknown = { isPending: true, isError: false, data: undefined, error: null }

mock.module('../src/hooks.ts', () => ({
  useMe: () => meState,
  isUnauthorized: (error: unknown) =>
    typeof error === 'object' && error !== null && 'status' in error && error.status === 401,
}))

mock.module('../src/auth-client.ts', () => ({
  signOut: async () => {},
}))

const { RequireMember } = await import('../src/components/RequireMember.tsx')

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

describe('RequireMember', () => {
  test('shows a loader while the session is loading', () => {
    meState = { isPending: true, isError: false, data: undefined, error: null }
    const { container } = renderAt('/t/alpha/roster')

    expect(screen.queryByText('roster screen')).toBeNull()
    expect(container.querySelector('[class*="Loader"], [class*="mantine-Loader"]')).not.toBeNull()
  })

  test('redirects to /login when the session is rejected with 401', () => {
    meState = { isPending: false, isError: true, data: undefined, error: { status: 401 } }
    renderAt('/t/alpha/roster')

    expect(screen.getByText('login screen')).toBeDefined()
    expect(screen.queryByText('roster screen')).toBeNull()
  })

  test('surfaces a non-auth error instead of redirecting', () => {
    meState = {
      isPending: false,
      isError: true,
      data: undefined,
      error: Object.assign(new Error('database is down'), { status: 500 }),
    }
    renderAt('/t/alpha/roster')

    expect(screen.getByText('Something broke')).toBeDefined()
    expect(screen.getByText('database is down')).toBeDefined()
    expect(screen.queryByText('login screen')).toBeNull()
  })

  test('an account in no team gets the no-team screen, not a roster', () => {
    meState = {
      isPending: false,
      isError: false,
      error: null,
      data: {
        id: '1',
        name: 'Julius',
        email: 'j@x',
        image: null,
        teamId: null,
        teamSlug: null,
        role: 'member',
        status: null,
      },
    }
    renderAt('/t/alpha/roster')

    expect(screen.getByText('No team yet')).toBeDefined()
    expect(screen.queryByText('roster screen')).toBeNull()
  })

  test('blocks a disabled account', () => {
    meState = {
      isPending: false,
      isError: false,
      error: null,
      data: {
        id: '1',
        name: 'Julius',
        email: 'j@x',
        image: null,
        teamId: 't1',
        teamSlug: 'alpha',
        role: 'member',
        status: 'disabled',
      },
    }
    renderAt('/t/alpha/roster')

    expect(screen.getByText('Access disabled')).toBeDefined()
    expect(screen.queryByText('roster screen')).toBeNull()
  })

  test('renders the page for an approved member', () => {
    meState = {
      isPending: false,
      isError: false,
      error: null,
      data: {
        id: '1',
        name: 'Julius',
        email: 'j@x',
        image: null,
        teamId: 't1',
        teamSlug: 'alpha',
        role: 'member',
        status: 'active',
      },
    }
    renderAt('/t/alpha/roster')

    expect(screen.getByText('roster screen')).toBeDefined()
  })

  test('shows the admin link only for captains', () => {
    meState = {
      isPending: false,
      isError: false,
      error: null,
      data: {
        id: '1',
        name: 'Captain',
        email: 'c@x',
        image: null,
        teamId: 't1',
        teamSlug: 'alpha',
        role: 'captain',
        status: 'active',
      },
    }
    renderAt('/t/alpha/roster')

    expect(screen.getByText('Admin')).toBeDefined()
  })
})
