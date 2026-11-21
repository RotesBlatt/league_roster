import { beforeEach, describe, expect, test } from 'bun:test'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { apiState, installApiMock, resetApiState } from './api-mock.ts'
import { installAuthMock } from './auth-mock.ts'

/**
 * The card's wiring only: what leaves the component (the body handed to the mutation),
 * where it navigates on success, and what a human sees when the API refuses. The
 * thinking itself is covered in `create-team.test.ts`.
 *
 * `api.ts` comes from the shared mock in api-mock.ts: bun's `mock.module` is process-wide,
 * so per-file factories clobber each other.
 */

installApiMock()
installAuthMock()

installAuthMock()

const { CreateTeamCard } = await import('../src/components/CreateTeamCard.tsx')

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={<CreateTeamCard signedInAs="Julius" />} />
            <Route path="/t/:slug/roster" element={<div>roster screen</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  )
}

function fillIn(name: string, shortName = '') {
  fireEvent.change(screen.getByPlaceholderText('Die Besten'), { target: { value: name } })
  if (shortName) {
    fireEvent.change(screen.getByPlaceholderText('DBW'), { target: { value: shortName } })
  }
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Create team' }))
}

beforeEach(() => {
  resetApiState()
})

describe('CreateTeamCard', () => {
  test('submits the trimmed name and lands on the new team', async () => {
    apiState.createTeam = { data: { teamSlug: 'die-besten' }, error: null, status: 200 }
    renderCard()

    fillIn('  Die Besten ', '  ')
    submit()

    expect(await screen.findByText('roster screen')).toBeDefined()
    expect(apiState.sentBody).toEqual({ name: 'Die Besten' })
  })

  test('sends the short name when one was typed', async () => {
    apiState.createTeam = { data: { teamSlug: 'die-besten' }, error: null, status: 200 }
    renderCard()

    fillIn('Die Besten', ' DBW ')
    submit()

    expect(await screen.findByText('roster screen')).toBeDefined()
    expect(apiState.sentBody).toEqual({ name: 'Die Besten', shortName: 'DBW' })
  })

  test('a blank name never reaches the API', () => {
    renderCard()

    fillIn('   ')
    submit()

    expect(apiState.sentBody).toBeUndefined()
    expect(screen.getByText('Give the team a name.')).toBeDefined()
  })

  test('a taken name is explained, not shown as a raw status', async () => {
    apiState.createTeam = {
      data: null,
      error: { message: 'That team name is already taken' },
      status: 409,
    }
    renderCard()

    fillIn('Die Besten')
    submit()

    expect(await screen.findByText(/different name/)).toBeDefined()
    expect(screen.queryByText('roster screen')).toBeNull()
  })

  test('the API’s own reason for a 422 is shown as written', async () => {
    apiState.createTeam = {
      data: null,
      error: { message: 'That name is reserved — pick another one' },
      status: 422,
    }
    renderCard()

    fillIn('Admin')
    submit()

    expect(await screen.findByText('That name is reserved — pick another one')).toBeDefined()
  })
})
