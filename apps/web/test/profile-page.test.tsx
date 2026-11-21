import { beforeEach, describe, expect, test } from 'bun:test'
import type { Me, ProfileDto, RiotAccountDto } from '@lol/api/schema-types'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { apiState, installApiMock, resetApiState } from './api-mock.ts'

/**
 * The profile page: what it shows, and what a save actually sends. The thinking lives in
 * `profile-form.ts` (unit-tested); this pins the wiring — prefill, badges, bodies.
 */
installApiMock()

const { ProfilePage } = await import('../src/pages/ProfilePage.tsx')

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

const saved: ProfileDto = {
  displayName: 'Jules',
  preferredRole: 'JGL',
  birthday: '2001-07-14',
  updatedAt: 0,
}

const mainAccount: RiotAccountDto = {
  id: 'acc-1',
  gameName: 'Hide on bush',
  tagLine: 'EUW',
  platform: 'euw1',
  isMain: true,
  verifiedAt: null,
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MantineProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/profile']}>
          <ProfilePage />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  )
}

beforeEach(() => {
  resetApiState()
  apiState.me = { data: me, error: null, status: 200 }
})

describe('the profile form', () => {
  test('opens with what was saved', async () => {
    apiState.profile = { data: saved, error: null, status: 200 }

    renderPage()

    expect(await screen.findByDisplayValue('Jules')).toBeDefined()
    expect(screen.getByDisplayValue('2001-07-14')).toBeDefined()
  })

  test('with nothing saved yet, the Discord name is offered as the display name', async () => {
    apiState.profile = { data: null, error: null, status: 200 }

    renderPage()

    expect(await screen.findByDisplayValue('Julius')).toBeDefined()
    // no birthday is not an error, and the field stays empty
    expect(screen.getByLabelText('Birthday')).toBeDefined()
  })

  test('editing saves itself after a pause, trimmed, with no Save button', async () => {
    apiState.profile = { data: saved, error: null, status: 200 }
    apiState.profileSave = { data: saved, error: null, status: 200 }

    renderPage()

    const name = await screen.findByDisplayValue('Jules')
    // a real change (and surrounding spaces, to prove the save is trimmed)
    fireEvent.change(name, { target: { value: '  Jules2  ' } })
    // the button is gone on purpose: the form saves itself
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()

    await waitFor(
      () =>
        expect(apiState.sentProfile).toEqual({
          displayName: 'Jules2',
          preferredRole: 'JGL',
          birthday: '2001-07-14',
        }),
      { timeout: 3000 },
    )
  })
})

describe('the accounts list', () => {
  test('shows each account with its main and unverified markers', async () => {
    apiState.profile = { data: saved, error: null, status: 200 }
    apiState.riotAccountList = { data: [mainAccount], error: null, status: 200 }

    renderPage()

    expect(await screen.findByText('Hide on bush#EUW')).toBeDefined()
    expect(screen.getByText('main')).toBeDefined()
    expect(screen.getByText('unverified')).toBeDefined()
  })

  test('adding an account sends both halves of the Riot ID', async () => {
    apiState.profile = { data: saved, error: null, status: 200 }
    apiState.riotAccountList = { data: [mainAccount], error: null, status: 200 }
    apiState.riotAccountAdd = { data: mainAccount, error: null, status: 200 }

    renderPage()

    fireEvent.change(await screen.findByLabelText('Game name'), {
      target: { value: ' Smurf ' },
    })
    fireEvent.change(screen.getByLabelText('Tag line'), { target: { value: 'EUW' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }))

    await waitFor(() => expect(apiState.sentAccount).toEqual({ gameName: 'Smurf', tagLine: 'EUW' }))
  })

  test('the only account can be removed — a mistyped Riot ID must be fixable', async () => {
    apiState.profile = { data: saved, error: null, status: 200 }
    apiState.riotAccountList = { data: [mainAccount], error: null, status: 200 }

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(apiState.sentAccountId).toBe('acc-1'))
  })

  test('the main account offers no "set main" button, the others do', async () => {
    apiState.profile = { data: saved, error: null, status: 200 }
    apiState.riotAccountList = {
      data: [mainAccount, { ...mainAccount, id: 'acc-2', gameName: 'Smurf', isMain: false }],
      error: null,
      status: 200,
    }

    renderPage()

    expect(await screen.findByText('Smurf#EUW')).toBeDefined()
    expect(screen.getAllByRole('button', { name: 'Set main' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(2)
  })
})
