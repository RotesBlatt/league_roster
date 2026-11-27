import { beforeEach, describe, expect, test } from 'bun:test'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { apiState, installApiMock, resetApiState } from '../../api-mock.ts'

/**
 * The hand-entry modal, rendered (match-history.md §5.8, §9).
 *
 * **This file exists because of a crash.** The form prefilled its five rows from a roster that
 * arrives after the first render, through an effect whose dependency was an array rebuilt on every
 * render — so the effect re-fired, set state, and React tore the page down with *"Maximum update
 * depth exceeded"*. A pure test could not see it; only actually rendering the component can.
 *
 * The rules themselves live in `lib/matches/manual-form.ts` and are unit-tested there; what is pinned
 * here is that the component **mounts, prefills, and stays mounted**.
 */
installApiMock()

/**
 * happy-dom has no `document.fonts`, and Mantine's autosizing `Textarea` subscribes to it on mount.
 * A test-environment gap, not a product one — stubbed here rather than removing autosize from the UI.
 */
if (!('fonts' in document)) {
  Object.defineProperty(document, 'fonts', {
    value: {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  })
}

const { ManualMatchForm } = await import('../../../src/components/matches/ManualMatchForm.tsx')

const roster = [
  { id: 'r1', userId: 'u1', displayName: 'Top Player', role: 'TOP', isActive: true, note: null },
  { id: 'r2', userId: 'u2', displayName: 'Jungle Player', role: 'JGL', isActive: true, note: null },
]

beforeEach(() => {
  resetApiState()
  apiState.rosterList = { data: roster, error: null, status: 200 }
  apiState.memberList = {
    data: [
      {
        id: 'u1',
        name: 'Top Player',
        email: 'top@test.local',
        image: null,
        role: 'member',
        status: 'active',
        createdAt: 0,
        hasRosterEntry: true,
        accounts: [],
      },
      {
        id: 'u2',
        name: 'Jungle Player',
        email: 'jgl@test.local',
        image: null,
        role: 'member',
        status: 'active',
        createdAt: 0,
        hasRosterEntry: true,
        accounts: [],
      },
    ],
    error: null,
    status: 200,
  }
})

function ui(node: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
    </MantineProvider>,
  )
}

describe('ManualMatchForm', () => {
  test('renders five player rows without looping', async () => {
    ui(<ManualMatchForm opened onClose={() => undefined} slug="team-a" />)

    // five rows, always: a missing player should be visible, not silently absent
    const rows = await screen.findAllByPlaceholderText('Pick a player')
    expect(rows.length).toBe(5)
  })

  test('prefills the roster it was given, in order', async () => {
    ui(<ManualMatchForm opened onClose={() => undefined} slug="team-a" />)

    expect(await screen.findByDisplayValue('Top Player')).toBeDefined()
    expect(await screen.findByDisplayValue('Jungle Player')).toBeDefined()
  })

  test('the enemy champion has its own column beside the player', async () => {
    ui(<ManualMatchForm opened onClose={() => undefined} slug="team-a" />)

    expect(await screen.findByText('Opponent')).toBeDefined()
    // one champion and one opponent select per row: the pairing is per player, never a loose list
    expect(screen.getAllByPlaceholderText('Champion').length).toBe(10)
  })
})
