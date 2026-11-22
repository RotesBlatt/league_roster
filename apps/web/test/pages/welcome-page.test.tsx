import { beforeEach, describe, expect, test } from 'bun:test'
import type { Me, ProfileDto } from '@lol/api/schema-types'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { apiState, installApiMock, resetApiState } from '../api-mock.ts'

/**
 * The first-login page. It is **blocking** on purpose: the roster is built from this, so "Continue"
 * only exists once `missingProfileFields` says nothing is missing — the same function the gate
 * uses, so the page and the gate cannot disagree.
 */
installApiMock()

const { WelcomePage } = await import('../../src/pages/WelcomePage.tsx')

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

const oneAccount = {
  id: 'acc-1',
  gameName: 'Hide on bush',
  tagLine: 'EUW',
  platform: 'euw1',
  isMain: true,
  verifiedAt: null,
}

const done: ProfileDto = {
  displayName: 'Jules',
  preferredRole: 'JGL',
  birthday: null,
  updatedAt: 0,
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MantineProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/welcome']}>
          <Routes>
            <Route path="/welcome" element={<WelcomePage />} />
            <Route path="/login" element={<div>login screen</div>} />
            <Route path="/" element={<div>the app</div>} />
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

describe('WelcomePage', () => {
  test('starts with the Discord name, and says what else is missing', async () => {
    apiState.profile = { data: null, error: null, status: 200 }

    renderPage()

    expect(await screen.findByDisplayValue('Julius')).toBeDefined()
    // role and one account are the two things still missing at this point
    expect(screen.getByText(/role/i, { selector: '[data-missing]' })).toBeDefined()
    expect(screen.getByText(/account/i, { selector: '[data-missing]' })).toBeDefined()
  })

  test('a signed-out visitor is sent to the login screen, not shown a form that cannot save', async () => {
    apiState.me = { data: null, error: { value: { message: 'Not signed in' } }, status: 401 }

    renderPage()

    expect(await screen.findByText('login screen')).toBeDefined()
  })

  test('here the only account can be removed — a mistyped Riot ID must be fixable', async () => {
    apiState.profile = { data: done, error: null, status: 200 }
    apiState.riotAccountList = { data: [oneAccount], error: null, status: 200 }

    renderPage()

    const remove = await screen.findByRole('button', { name: 'Remove' })
    expect(remove.hasAttribute('disabled')).toBe(false)

    fireEvent.click(remove)

    await waitFor(() => expect(apiState.sentAccountId).toBe('acc-1'))
  })

  test('Continue is unavailable while something is missing', async () => {
    apiState.profile = { data: done, error: null, status: 200 }
    apiState.riotAccountList = { data: [], error: null, status: 200 }

    renderPage()

    const button = await screen.findByRole('button', { name: 'Continue' })
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  test('once nothing is missing, Continue leads into the app', async () => {
    apiState.profile = { data: done, error: null, status: 200 }
    apiState.riotAccountList = {
      data: [oneAccount],
      error: null,
      status: 200,
    }

    renderPage()

    const button = await screen.findByRole('button', { name: 'Continue' })
    expect(button.hasAttribute('disabled')).toBe(false)

    fireEvent.click(button)

    expect(await screen.findByText('the app')).toBeDefined()
  })
})
