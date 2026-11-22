import { beforeEach, describe, expect, test } from 'bun:test'
import type { TeamSummary } from '@lol/api/schema-types'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { apiState, installApiMock, resetApiState } from './api-mock.ts'

/**
 * The rename card's wiring: what it starts with, when Save is allowed, what it sends (including
 * the empty short name that clears a tag), and where it lands afterwards. The thinking itself —
 * trimming, limits, `unchanged`, messages — is `lib/team/writes.test.ts`.
 */

const alpha: TeamSummary = {
  id: 'id-alpha',
  slug: 'alpha',
  name: 'Alpha',
  shortName: 'AL',
  role: 'captain',
}

installApiMock()

const { TeamSettingsCard } = await import('../src/components/team/TeamSettingsCard.tsx')

function AdminProbe() {
  const { slug } = useParams()
  return <div>admin of {slug}</div>
}

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/t/alpha/admin']}>
          <Routes>
            <Route
              path="/t/:slug/admin"
              element={
                <>
                  <TeamSettingsCard key={alpha.id} team={alpha} />
                  <AdminProbe />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  )
}

const save = () => screen.getByRole('button', { name: /save/i }) as HTMLButtonElement
const nameField = () => screen.getByLabelText('Team name') as HTMLInputElement
const shortNameField = () => screen.getByLabelText('Short name') as HTMLInputElement

beforeEach(() => {
  resetApiState()
})

describe('TeamSettingsCard', () => {
  test('starts with the current name and short name', () => {
    renderCard()

    expect(nameField().value).toBe('Alpha')
    expect(shortNameField().value).toBe('AL')
  })

  test('Save is disabled until something actually changes', async () => {
    renderCard()
    expect(save().disabled).toBe(true)

    fireEvent.change(nameField(), { target: { value: 'Alpha 2' } })

    await waitFor(() => expect(save().disabled).toBe(false))

    // and back to the original value is "no change" again
    fireEvent.change(nameField(), { target: { value: 'Alpha' } })
    await waitFor(() => expect(save().disabled).toBe(true))
  })

  test('saves the trimmed name, sends an emptied tag as "", and follows the new slug', async () => {
    apiState.renameTeam = {
      data: { id: alpha.id, slug: 'neue-welle', name: 'Neue Welle', shortName: null },
      error: null,
      status: 200,
    }
    renderCard()

    fireEvent.change(nameField(), { target: { value: '  Neue Welle ' } })
    fireEvent.change(shortNameField(), { target: { value: '' } })
    fireEvent.click(save())

    // the URL moves with the name, so the card navigates instead of leaving a dead slug
    expect(await screen.findByText('admin of neue-welle')).toBeDefined()
    expect(apiState.sentRename).toEqual({
      slug: 'alpha',
      body: { name: 'Neue Welle', shortName: '' },
    })
  })

  test('a rename that keeps the same slug stays where it is', async () => {
    apiState.renameTeam = {
      data: { id: alpha.id, slug: 'alpha', name: 'Alpha 2', shortName: 'A2' },
      error: null,
      status: 200,
    }
    renderCard()

    fireEvent.change(nameField(), { target: { value: 'Alpha 2' } })
    fireEvent.change(shortNameField(), { target: { value: 'A2' } })
    fireEvent.click(save())

    expect(await screen.findByText('admin of alpha')).toBeDefined()
    expect(apiState.sentRename).toEqual({
      slug: 'alpha',
      body: { name: 'Alpha 2', shortName: 'A2' },
    })
  })

  test('a taken name shows advice and does not navigate', async () => {
    apiState.renameTeam = {
      data: null,
      error: { value: { message: 'That team name is already taken' } },
      status: 409,
    }
    renderCard()

    fireEvent.change(nameField(), { target: { value: 'Belegt' } })
    fireEvent.click(save())

    expect(await screen.findByText(/different name/i)).toBeDefined()
    expect(screen.getByText('admin of alpha')).toBeDefined()
  })

  test('a name the API rejects passes its reason through', async () => {
    apiState.renameTeam = {
      data: null,
      error: { value: { message: 'That name is reserved — pick another one' } },
      status: 422,
    }
    renderCard()

    fireEvent.change(nameField(), { target: { value: 'Admin' } })
    fireEvent.click(save())

    expect(await screen.findByText('That name is reserved — pick another one')).toBeDefined()
  })
})
