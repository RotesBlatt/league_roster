import { beforeEach, describe, expect, test } from 'bun:test'
import type { Me } from '@lol/api/schema-types'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { apiState, installApiMock, resetApiState } from './api-mock.ts'
import { installAuthMock } from './auth-mock.ts'

/**
 * The real routing, not the page in isolation: `/profile` sits inside `RequireCompleteProfile`
 * *and* `RequireMember`, so a regression in either gate shows up as a blank screen — which unit
 * tests of the page cannot see.
 */
installApiMock()
installAuthMock()

installAuthMock()

const { App } = await import('../src/App.tsx')

const me: Me = {
  id: 'u1',
  name: 'Julius',
  email: 'j@test.local',
  image: null,
  teamId: 't1',
  teamSlug: 'alpha',
  role: 'member',
  status: 'active',
}

function renderAt(pathname: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MantineProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[pathname]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  )
}

beforeEach(() => {
  resetApiState()
  apiState.me = { data: me, error: null, status: 200 }
  apiState.profile = {
    data: { displayName: 'Jules', preferredRole: 'JGL', birthday: null, updatedAt: 0 },
    error: null,
    status: 200,
  }
  apiState.riotAccountList = {
    data: [
      {
        id: 'acc-1',
        gameName: 'Hide on bush',
        tagLine: 'EUW',
        platform: 'euw1',
        isMain: true,
        verifiedAt: null,
      },
    ],
    error: null,
    status: 200,
  }
  apiState.teamList = { data: [], error: null, status: 200 }
})

describe('the profile route', () => {
  test('a failed profile read is shown, not mistaken for "incomplete"', async () => {
    apiState.profile = { data: null, error: { value: { message: 'Not found' } }, status: 404 }

    renderAt('/t/alpha/profile')

    expect(await screen.findByText('Could not load your profile')).toBeDefined()
    expect(screen.queryByText('Set up your profile')).toBeNull()
  })

  test('an incomplete profile goes to /welcome instead of a blank /profile', async () => {
    apiState.profile = { data: null, error: null, status: 200 }
    apiState.riotAccountList = { data: [], error: null, status: 200 }

    renderAt('/t/alpha/profile')

    expect(await screen.findByRole('heading', { name: 'Set up your profile' })).toBeDefined()
  })

  test('renders the page inside the app shell for a member with a complete profile', async () => {
    renderAt('/t/alpha/profile')

    expect(await screen.findByRole('heading', { name: 'My profile' })).toBeDefined()
    expect(await screen.findByDisplayValue('Jules')).toBeDefined()
    // the shell is there too — this is not a bare page outside the layout
    expect(screen.getByText('Roster')).toBeDefined()
  })
})
