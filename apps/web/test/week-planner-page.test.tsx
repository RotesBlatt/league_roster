import { beforeEach, describe, expect, test } from 'bun:test'
import type { Me, PlannerDto, PlannerWeekDto, RosterEntryDto } from '@lol/api/schema-types'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { apiState, installApiMock, resetApiState } from './api-mock.ts'

/**
 * The planner page as a member sees it: paint, save, and read who is missing.
 *
 * The page is tested for what it *sends* and what it *shows*; the painting rules themselves are
 * `availability-grid.ts`'s unit tests, and "which times are playable" is the API's.
 */
installApiMock()

const { WeekPlannerPage } = await import('../src/pages/WeekPlannerPage.tsx')

const me: Me = {
  id: 'me',
  name: 'Anna',
  email: 'anna@test.local',
  image: null,
  teamId: 't1',
  teamSlug: 'alpha',
  role: 'member',
  status: 'active',
}

const roster: RosterEntryDto[] = ['Anna', 'Ben', 'Cem'].map((displayName, index) => ({
  id: `e${index}`,
  userId: index === 0 ? 'me' : `u${index + 1}`,
  displayName,
  role: null,
  note: null,
  isActive: true,
  account: null,
}))

const week = (overrides: Partial<PlannerWeekDto> = {}): PlannerWeekDto => ({
  startsOn: '2026-11-23',
  unlocked: false,
  answered: ['me'],
  unanswered: ['u2', 'u3'],
  availability: [{ userId: 'me', dayOfWeek: 1, startMinute: 1200, endMinute: 1380 }],
  days: Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    windows:
      dayOfWeek === 1 ? [{ start: 1200, end: 1380, count: 4, users: [], missing: ['u3'] }] : [],
  })),
  ...overrides,
})

const planner = (first: PlannerWeekDto): PlannerDto => ({
  timezone: 'Europe/Berlin',
  today: '2026-11-25',
  windowStart: '2026-11-23',
  roster: ['me', 'u2', 'u3'],
  weeks: [
    first,
    week({
      startsOn: '2026-11-30',
      availability: [],
      answered: [],
      unanswered: ['me', 'u2', 'u3'],
    }),
  ],
})

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MantineProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/t/alpha/planner']}>
          <Routes>
            <Route path="/t/:slug/planner" element={<WeekPlannerPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  )
}

/** Queries resolve in a microtask, so a test first waits for the board, then reads it synchronously. */
const cell = (label: string) => screen.findByRole('button', { name: label })
const pressed = (label: string) =>
  screen.getByRole('button', { name: label }).getAttribute('aria-pressed')

beforeEach(() => {
  resetApiState()
  apiState.me = { data: me, error: null, status: 200 }
  apiState.rosterList = { data: roster, error: null, status: 200 }
  apiState.plannerTemplate = { data: { days: [] }, error: null, status: 200 }
  apiState.planner = { data: planner(week()), error: null, status: 200 }
})

describe('what the page shows', () => {
  test('names the two visible weeks and the zone it speaks in', async () => {
    renderPage()

    expect(await screen.findByRole('tab', { name: /This week · / })).toBeDefined()
    expect(await screen.findByRole('tab', { name: /Next week · / })).toBeDefined()
    expect(await screen.findByText('Europe/Berlin')).toBeDefined()
  })

  test('a partly answered week says so, and names who is still missing', async () => {
    renderPage()

    expect(await screen.findByText('1 of 3 answered — these times are provisional')).toBeDefined()
    expect(await screen.findByText('provisional')).toBeDefined()
    expect(await screen.findByText(/Still to answer:/)).toBeDefined()
    expect(await screen.findByText('Ben, Cem')).toBeDefined()
  })

  test('the best session is called out with its count and who cannot make it', async () => {
    renderPage()

    expect(await screen.findByText('Tue 20:00–23:00')).toBeDefined()
    expect(await screen.findByText('4 available')).toBeDefined()
    expect(await screen.findByText('missing: Cem')).toBeDefined()
  })

  test('an answered week opens on what I saved, not on my standing schedule', async () => {
    apiState.plannerTemplate = {
      data: { days: [{ dayOfWeek: 1, intervals: [{ start: 1380, end: 1440 }] }] },
      error: null,
      status: 200,
    }

    renderPage()

    await cell('Tue 20:00')

    expect(pressed('Tue 20:00')).toBe('true')
    expect(pressed('Tue 23:00')).toBe('false')
    expect(await screen.findByText(/Your week as saved/)).toBeDefined()
  })

  test('an unanswered week starts from the standing times, and says nothing is saved yet', async () => {
    apiState.planner = {
      data: planner(week({ answered: [], unanswered: ['me', 'u2', 'u3'], availability: [] })),
      error: null,
      status: 200,
    }
    apiState.plannerTemplate = {
      data: { days: [{ dayOfWeek: 1, intervals: [{ start: 1380, end: 1440 }] }] },
      error: null,
      status: 200,
    }

    renderPage()

    await cell('Tue 23:00')

    expect(pressed('Tue 23:00')).toBe('true')
    expect(await screen.findByText(/Nothing is saved until you save/)).toBeDefined()
  })
})

describe('painting and saving', () => {
  test('one painted cell is one half hour in the body', async () => {
    renderPage()

    fireEvent.pointerDown(await cell('Mon 09:00'))
    await waitFor(() => expect(pressed('Mon 09:00')).toBe('true'))

    fireEvent.click(await screen.findByRole('button', { name: 'Save my week' }))
    await waitFor(() => expect(apiState.sentPlanner).toBeDefined())

    const sent = apiState.sentPlanner as {
      startsOn: string
      body: { days: { dayOfWeek: number; intervals: { start: number; end: number }[] }[] }
    }
    expect(sent.startsOn).toBe('2026-11-23')
    expect(sent.body.days[0]).toEqual({
      dayOfWeek: 0,
      intervals: [{ start: 540, end: 570 }],
    })
  })

  test('a drag paints the range it covered', async () => {
    renderPage()

    fireEvent.pointerDown(await cell('Wed 18:00'))
    fireEvent.pointerEnter(await cell('Wed 19:00'))
    await waitFor(() => expect(pressed('Wed 19:00')).toBe('true'))
    fireEvent.click(await screen.findByRole('button', { name: 'Save my week' }))
    await waitFor(() => expect(apiState.sentPlanner).toBeDefined())

    const sent = apiState.sentPlanner as {
      body: { days: { dayOfWeek: number; intervals: { start: number; end: number }[] }[] }
    }
    expect(sent.body.days[2]).toEqual({
      dayOfWeek: 2,
      intervals: [{ start: 1080, end: 1170 }],
    })
  })

  test('undo puts the grid back to where the gesture started', async () => {
    renderPage()

    fireEvent.pointerDown(await cell('Thu 20:00'))
    fireEvent.pointerEnter(await cell('Thu 22:00'))
    await waitFor(() => expect(pressed('Thu 21:00')).toBe('true'))

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(pressed('Thu 20:00')).toBe('false'))
    expect(pressed('Thu 21:00')).toBe('false')
  })
})

describe('the captain’s window', () => {
  test('a member sees no window controls at all', async () => {
    renderPage()

    await cell('Mon 09:00')
    expect(screen.queryByRole('button', { name: 'Forward' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Back to this week' })).toBeNull()
  })

  test('a captain can move the window forward and back, and return to this week', async () => {
    apiState.me = { data: { ...me, role: 'captain' }, error: null, status: 200 }

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Forward' }))
    await waitFor(() => expect(apiState.sentSkip).toEqual({ weeks: 1 }))

    fireEvent.click(await screen.findByRole('button', { name: 'Back' }))
    await waitFor(() => expect(apiState.sentSkip).toEqual({ weeks: -1 }))

    fireEvent.click(await screen.findByRole('button', { name: 'Back to this week' }))
    await waitFor(() => expect(apiState.sentReset).toBe(true))
  })

  test('a refused skip does not move anything — the server said no', async () => {
    apiState.me = { data: { ...me, role: 'captain' }, error: null, status: 200 }
    apiState.plannerSkip = {
      data: null,
      error: { value: { message: 'Already on this week' } },
      status: 409,
    }

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Back' }))
    await waitFor(() => expect(apiState.sentSkip).toEqual({ weeks: -1 }))
    // the board is still the week the planner reported; a refusal changed no state
    expect((await cell('Tue 20:00')).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('history', () => {
  const past = (overrides: Partial<PlannerWeekDto> = {}) =>
    week({ startsOn: '2026-11-16', ...overrides })

  test('lists the weeks before the window by date', async () => {
    renderPage()

    await cell('Mon 09:00')
    expect(await screen.findByRole('button', { name: /16–22 Nov/ })).toBeDefined()
    expect(await screen.findByRole('button', { name: /9–15 Nov/ })).toBeDefined()
    expect(await screen.findByRole('button', { name: /2–8 Nov/ })).toBeDefined()
    expect(await screen.findByRole('button', { name: /26 Oct – 1 Nov/ })).toBeDefined()
  })

  test('a member reads a finished week without opening it', async () => {
    apiState.plannerWeek = {
      data: past({ answered: ['me', 'u2', 'u3'], unanswered: [] }),
      error: null,
      status: 200,
    }

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /16–22 Nov/ }))
    await waitFor(() => expect(apiState.sentWeekParam).toBe('2026-11-16'))

    expect(await screen.findByText('complete')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Open for editing' })).toBeNull()
    // the only editable grid is the live week
    expect(screen.getAllByRole('button', { name: 'Save my week' })).toHaveLength(1)
  })

  test('a captain opens a finished week for writing', async () => {
    apiState.me = { data: { ...me, role: 'captain' }, error: null, status: 200 }
    apiState.plannerWeek = { data: past(), error: null, status: 200 }

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /16–22 Nov/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Open for editing' }))

    await waitFor(() =>
      expect(apiState.sentUnlock).toEqual({ startsOn: '2026-11-16', unlocked: true }),
    )
  })

  test('an opened week becomes editable, with its own save', async () => {
    apiState.me = { data: { ...me, role: 'captain' }, error: null, status: 200 }
    apiState.plannerWeek = {
      data: past({
        unlocked: true,
        answered: [],
        unanswered: ['me', 'u2', 'u3'],
        availability: [],
      }),
      error: null,
      status: 200,
    }

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /16–22 Nov/ }))

    expect(await screen.findByText('open for edits')).toBeDefined()
    expect(await screen.findByRole('button', { name: 'Close week' })).toBeDefined()
    expect(screen.getAllByRole('button', { name: 'Save my week' })).toHaveLength(2)
  })
})

describe('my regular times', () => {
  const editor = () => within(screen.getByLabelText('Regular times grid'))

  const openEditor = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'My regular times' }))
    await screen.findByRole('button', { name: 'Save my regular times' })
  }

  test('starts collapsed — a standing schedule is not what you came here to paint', async () => {
    renderPage()

    await cell('Mon 09:00')
    expect(screen.queryByRole('button', { name: 'Save my regular times' })).toBeNull()
    expect(screen.queryByLabelText('Regular times grid')).toBeNull()
  })

  test('opens on the times I saved before', async () => {
    apiState.plannerTemplate = {
      data: { days: [{ dayOfWeek: 2, intervals: [{ start: 1200, end: 1260 }] }] },
      error: null,
      status: 200,
    }

    renderPage()
    await openEditor()

    expect(editor().getByRole('button', { name: 'Wed 20:00' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(editor().getByRole('button', { name: 'Wed 21:00' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })

  test('painting and saving sends the template, and writes no week', async () => {
    renderPage()
    await openEditor()

    fireEvent.pointerDown(editor().getByRole('button', { name: 'Thu 21:00' }))
    await waitFor(() =>
      expect(editor().getByRole('button', { name: 'Thu 21:00' }).getAttribute('aria-pressed')).toBe(
        'true',
      ),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Save my regular times' }))
    await waitFor(() => expect(apiState.sentPlannerTemplate).toBeDefined())

    const sent = apiState.sentPlannerTemplate as {
      days: { dayOfWeek: number; intervals: { start: number; end: number }[] }[]
    }
    expect(sent.days[3]).toEqual({ dayOfWeek: 3, intervals: [{ start: 1260, end: 1290 }] })
    // a template is not an answer: no week save went out
    expect(apiState.sentPlanner).toBeUndefined()
  })
})

describe('which week is actually now', () => {
  test('the real current week is marked in the tab header', async () => {
    renderPage()

    const tab = await screen.findByRole('tab', { name: /This week · / })
    expect(within(tab).getByText('now')).toBeDefined()
    // only one tab is the current week
    expect(screen.getAllByText('now')).toHaveLength(1)
  })

  test('a window the captain skipped ahead of says the current week is behind it', async () => {
    apiState.planner = {
      data: {
        ...planner(week({ startsOn: '2026-12-07' })),
        windowStart: '2026-12-07',
        weeks: [
          week({
            startsOn: '2026-12-07',
            answered: [],
            unanswered: ['me', 'u2', 'u3'],
            availability: [],
          }),
          week({
            startsOn: '2026-12-14',
            answered: [],
            unanswered: ['me', 'u2', 'u3'],
            availability: [],
          }),
        ],
      },
      error: null,
      status: 200,
    }

    renderPage()

    await screen.findByRole('tab', { name: /7–13 Dec/ })
    expect(screen.queryByText('now')).toBeNull()
    expect(
      screen.getByText(/starts later than the current week \(23–29 Nov · Week 48\)/),
    ).toBeDefined()
  })
})
