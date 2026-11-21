import { beforeEach, describe, expect, test } from 'bun:test'
import type { Me, ProfileDto } from '@lol/api/schema-types'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { apiState, installApiMock, resetApiState } from './api-mock.ts'

/**
 * The gate between "signed in" and "the app". It answers one question — `missingProfileFields`
 * on empty? — and sends you to `/welcome` until the answer is no. Because the same rule decides
 * the welcome page's Continue button, the two cannot disagree.
 *
 * This is the "already registered player" case: everyone who existed before the table has no
 * profile row, so their first load after the deploy lands here once, with nothing to backfill.
 */
installApiMock()

const { RequireCompleteProfile } = await import('../src/components/RequireCompleteProfile.tsx')

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

const done: ProfileDto = {
  displayName: 'Jules',
  preferredRole: 'JGL',
  birthday: null,
  updatedAt: 0,
}

const oneAccount = {
  id: 'acc-1',
  gameName: 'Hide on bush',
  tagLine: 'EUW',
  platform: 'euw1',
  isMain: true,
  verifiedAt: null,
}

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MantineProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/t/alpha/roster']}>
          <Routes>
            <Route path="/login" element={<div>login screen</div>} />
            <Route path="/welcome" element={<div>welcome screen</div>} />
            <Route element={<RequireCompleteProfile />}>
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
  apiState.me = { data: me, error: null, status: 200 }
})

describe('RequireCompleteProfile', () => {
  test('a player who never set up a profile is sent to /welcome', async () => {
    apiState.profile = { data: null, error: null, status: 200 }

    renderApp()

    expect(await screen.findByText('welcome screen')).toBeDefined()
    expect(screen.queryByText('roster screen')).toBeNull()
  })

  test('name and role alone are not enough — an account is part of the profile', async () => {
    apiState.profile = { data: done, error: null, status: 200 }
    apiState.riotAccountList = { data: [], error: null, status: 200 }

    renderApp()

    expect(await screen.findByText('welcome screen')).toBeDefined()
  })

  test('a complete profile opens the app', async () => {
    apiState.profile = { data: done, error: null, status: 200 }
    apiState.riotAccountList = { data: [oneAccount], error: null, status: 200 }

    renderApp()

    expect(await screen.findByText('roster screen')).toBeDefined()
    expect(screen.queryByText('welcome screen')).toBeNull()
  })

  test('while the profile is still loading it waits, instead of flashing /welcome', () => {
    apiState.pending.me = true

    const { container } = renderApp()

    expect(screen.queryByText('welcome screen')).toBeNull()
    expect(screen.queryByText('roster screen')).toBeNull()
    expect(container.querySelector('[class*="mantine-Loader"]')).not.toBeNull()
  })

  test('a signed-out visitor goes to the login screen, not to welcome', async () => {
    apiState.me = { data: null, error: { value: { message: 'Not signed in' } }, status: 401 }

    renderApp()

    expect(await screen.findByText('login screen')).toBeDefined()
  })
})
