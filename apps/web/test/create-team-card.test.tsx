import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { ApiError, unwrap } from '../src/api-result.ts'

/**
 * The card's wiring only: what leaves the component (the body handed to the mutation),
 * where it navigates on success, and what a human sees when the API refuses. The
 * thinking itself is covered in `create-team.test.ts`.
 *
 * The network edge is mocked, not `hooks.ts`: `mock.module` is process-wide in bun, so a
 * second mock of `hooks.ts` would replace the one `require-member.test.tsx` registered and
 * break it. Mocking `api` keeps the real `useCreateTeam` and `unwrap` in the loop.
 */

type Result = { data: unknown; error: unknown; status: number }
let nextResult: Result = { data: null, error: null, status: 200 }
let sentBody: unknown

mock.module('../src/api.ts', () => ({
  ApiError,
  unwrap,
  api: {
    teams: {
      post: (body: unknown) => {
        sentBody = body
        return Promise.resolve(nextResult)
      },
    },
  },
}))

mock.module('../src/auth-client.ts', () => ({
  signOut: async () => {},
}))

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
  sentBody = undefined
  nextResult = { data: null, error: null, status: 200 }
})

describe('CreateTeamCard', () => {
  test('submits the trimmed name and lands on the new team', async () => {
    nextResult = { data: { teamSlug: 'die-besten' }, error: null, status: 200 }
    renderCard()

    fillIn('  Die Besten ', '  ')
    submit()

    expect(await screen.findByText('roster screen')).toBeDefined()
    expect(sentBody).toEqual({ name: 'Die Besten' })
  })

  test('sends the short name when one was typed', async () => {
    nextResult = { data: { teamSlug: 'die-besten' }, error: null, status: 200 }
    renderCard()

    fillIn('Die Besten', ' DBW ')
    submit()

    expect(await screen.findByText('roster screen')).toBeDefined()
    expect(sentBody).toEqual({ name: 'Die Besten', shortName: 'DBW' })
  })

  test('a blank name never reaches the API', () => {
    renderCard()

    fillIn('   ')
    submit()

    expect(sentBody).toBeUndefined()
    expect(screen.getByText('Give the team a name.')).toBeDefined()
  })

  test('a taken name is explained, not shown as a raw status', async () => {
    nextResult = {
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
    nextResult = {
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
