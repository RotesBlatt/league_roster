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
  noPractice: false,
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

/** The week has two views: what I paint, and what the team can actually play. */
const showPlayable = () => fireEvent.click(screen.getByRole('radio', { name: 'Playable times' }))

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

    await cell('Tue 20:00')
    showPlayable()

    expect(await screen.findByText('1 of 3 answered — these times are provisional')).toBeDefined()
    expect(await screen.findByText('provisional')).toBeDefined()
    const waiting = await screen.findByRole('group', { name: 'Waiting on' })
    expect(within(waiting).getByText('Ben')).toBeDefined()
    expect(within(waiting).getByText('Cem')).toBeDefined()
  })

  test('opening Playable asks the server again instead of trusting the cache', async () => {
    renderPage()

    await cell('Mon 09:00')
    const before = apiState.calls.plannerGet

    showPlayable()

    // my own availability may have been saved while I was painting; the summary is the server's
    await waitFor(() => expect(apiState.calls.plannerGet).toBeGreaterThan(before))
  })

  test('the best session is called out with its count and who cannot make it', async () => {
    renderPage()

    await cell('Tue 20:00')
    showPlayable()

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

  test('a painted week saves itself after a pause, and undo still saves the undo', async () => {
    renderPage()

    fireEvent.pointerDown(await cell('Mon 09:00'))
    await waitFor(() => expect(pressed('Mon 09:00')).toBe('true'))

    // nobody pressed Save: the pause did
    await waitFor(() => expect(apiState.sentPlanner).toBeDefined(), { timeout: 3000 })
    const saved = apiState.sentPlanner as {
      body: { days: { intervals: { start: number; end: number }[] }[] }
    }
    expect(saved.body.days[0]?.intervals).toEqual([{ start: 540, end: 570 }])

    // the grid now agrees with the server, so Save is disabled — but undo is not
    expect(screen.getByRole('button', { name: 'Save my week' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false)

    // undoing is itself a change, so the pause saves it again
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(
      () => {
        const latest = apiState.sentPlanner as {
          body: { days: { intervals: { start: number; end: number }[] }[] }
        }
        expect(latest.body.days[0]?.intervals).toEqual([])
      },
      { timeout: 3000 },
    )
    expect(pressed('Mon 09:00')).toBe('false')
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

describe('saying there is no practice', () => {
  const asCaptain = () => {
    apiState.me = { data: { ...me, role: 'captain' }, error: null, status: 200 }
  }

  test('a marked week shows the badge next to “complete”, but only a captain gets the control', async () => {
    apiState.planner = {
      data: planner(week({ noPractice: true, answered: ['me', 'u2', 'u3'], unanswered: [] })),
      error: null,
      status: 200,
    }

    renderPage()

    await cell('Mon 09:00')
    showPlayable()

    const status = await screen.findByRole('group', { name: 'Week status' })
    expect(within(status).getByText('complete')).toBeDefined()
    expect(within(status).getByText('No practice this week')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Clear no practice' })).toBeNull()
  })

  test('a captain can mark the week, and the route is told which Monday', async () => {
    asCaptain()
    renderPage()

    await cell('Mon 09:00')
    showPlayable()
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as no practice' }))

    await waitFor(() =>
      expect(apiState.sentNoPractice).toEqual({ startsOn: '2026-11-23', noPractice: true }),
    )
  })

  test('a marked week offers clearing it', async () => {
    asCaptain()
    apiState.planner = { data: planner(week({ noPractice: true })), error: null, status: 200 }

    renderPage()

    await cell('Mon 09:00')
    showPlayable()
    fireEvent.click(await screen.findByRole('button', { name: 'Clear no practice' }))

    await waitFor(() =>
      expect(apiState.sentNoPractice).toEqual({ startsOn: '2026-11-23', noPractice: false }),
    )
  })
})

describe('the captain’s window', () => {
  const captain = () => {
    apiState.me = { data: { ...me, role: 'captain' }, error: null, status: 200 }
  }

  test('a member sees no window controls at all', async () => {
    renderPage()

    await cell('Mon 09:00')
    expect(screen.queryByRole('button', { name: 'Later week' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Back to this week' })).toBeNull()
  })

  test('the controls say what they move, and that they are captain-only', async () => {
    captain()
    renderPage()

    expect(await screen.findByText('Planning 23–29 Nov · Week 48')).toBeDefined()
    expect(screen.getByText('Captain only')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Earlier week' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Later week' })).toBeDefined()
    expect(screen.getByText(/Moves the two-week view for the whole team/)).toBeDefined()
  })

  test('"Back to this week" is outlined like its siblings and disabled when already there', async () => {
    captain()
    renderPage()

    const reset = await screen.findByRole('button', { name: 'Back to this week' })

    // subtle text with no border reads as a label, not as something you can press
    expect(reset.getAttribute('data-variant')).toBe('default')
    expect(reset.hasAttribute('disabled')).toBe(true)
  })

  test('a captain can move the window later and earlier', async () => {
    captain()
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Later week' }))
    await waitFor(() => expect(apiState.sentSkip).toEqual({ weeks: 1 }))

    fireEvent.click(await screen.findByRole('button', { name: 'Earlier week' }))
    await waitFor(() => expect(apiState.sentSkip).toEqual({ weeks: -1 }))
  })

  test('a skipped window can be returned to this week, and says which window it is on', async () => {
    captain()
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

    expect(await screen.findByText('Planning 7–13 Dec · Week 50')).toBeDefined()
    const reset = await screen.findByRole('button', { name: 'Back to this week' })
    expect(reset.hasAttribute('disabled')).toBe(false)

    fireEvent.click(reset)
    await waitFor(() => expect(apiState.sentReset).toBe(true))
  })

  test('a refused skip does not move anything — the server said no', async () => {
    captain()
    apiState.plannerSkip = {
      data: null,
      error: { value: { message: 'Already on this week' } },
      status: 409,
    }

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Earlier week' }))
    await waitFor(() => expect(apiState.sentSkip).toEqual({ weeks: -1 }))
    // the board is still the week the planner reported; a refusal changed no state
    expect((await cell('Tue 20:00')).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('the view switch', () => {
  test('sits above the week tabs, regular times first, and opens on my availability', async () => {
    renderPage()

    const tabs = await screen.findByRole('tab', { name: /This week · / })
    const radios = screen.getAllByRole('radio')

    const order = ['My regular times', 'My availability', 'Playable times'].map((name) =>
      screen.getByRole('radio', { name }),
    )

    expect(order).toHaveLength(radios.length)
    expect(order[0]?.compareDocumentPosition(order[1]!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(order[1]?.compareDocumentPosition(order[2]!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(
      (screen.getByRole('radio', { name: 'My availability' }) as HTMLInputElement).checked,
    ).toBe(true)
    // the switch chooses how the week is shown, so it reads before the week it applies to
    expect(radios[0]?.compareDocumentPosition(tabs)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })
})

describe('two views of the week', () => {
  test('the week opens on what I paint, not on the team summary', async () => {
    renderPage()

    expect(await screen.findByRole('group', { name: 'Your availability' })).toBeDefined()
    // the summary used to sit under the grid, unreadable next to 336 cells
    expect(screen.queryByRole('group', { name: 'Everyone’s availability' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Waiting on' })).toBeNull()
  })

  test('a member switches to the team grid without losing who is missing', async () => {
    renderPage()

    await cell('Tue 20:00')
    showPlayable()

    expect(await screen.findByRole('group', { name: 'Everyone’s availability' })).toBeDefined()
    // the paint grid is gone, not stacked under the read-only one
    expect(screen.queryByRole('group', { name: 'Your availability' })).toBeNull()
    expect(screen.getByText('provisional')).toBeDefined()
    // names are chips, not a sentence you can walk past
    const waiting = screen.getByRole('group', { name: 'Waiting on' })
    expect(within(waiting).getByText('Ben')).toBeDefined()
    expect(within(waiting).getByText('Cem')).toBeDefined()
    expect(screen.getByText('Tue 20:00–23:00')).toBeDefined()
    expect(screen.getByText('missing: Cem')).toBeDefined()
  })

  test('switching back returns to the grid I can paint, and nothing was saved', async () => {
    renderPage()

    await cell('Tue 20:00')
    showPlayable()
    fireEvent.click(await screen.findByRole('radio', { name: 'My availability' }))

    expect(await screen.findByRole('group', { name: 'Your availability' })).toBeDefined()
    expect(pressed('Tue 20:00')).toBe('true')
    expect(apiState.sentPlanner).toBeUndefined()
  })
})

describe('who has not answered yet', () => {
  test('a member sees the pending names as chips on the playable view', async () => {
    renderPage()

    await cell('Tue 20:00')
    showPlayable()

    const waiting = await screen.findByRole('group', { name: 'Waiting on' })
    // one chip per person, so two people are not one string
    expect(within(waiting).getAllByText(/Ben|Cem/)).toHaveLength(2)
    expect(within(waiting).getByText('Ben')).toBeDefined()
    expect(within(waiting).getByText('Cem')).toBeDefined()
  })

  test('the count and the waiting chips share one line', async () => {
    renderPage()

    await cell('Tue 20:00')
    showPlayable()

    await screen.findByText('1 of 3 answered — these times are provisional')
    const waiting = screen.getByRole('group', { name: 'Waiting on' })

    // one row of exactly these two, so answering (or switching week) moves the grid by one line
    const row = waiting.parentElement
    expect(row?.children).toHaveLength(2)
    expect(row?.textContent).toContain('1 of 3 answered')
  })

  test('a complete week says so instead of showing an empty row', async () => {
    apiState.planner = {
      data: planner(week({ answered: ['me', 'u2', 'u3'], unanswered: [] })),
      error: null,
      status: 200,
    }

    renderPage()

    await cell('Tue 20:00')
    showPlayable()

    const waiting = await screen.findByRole('group', { name: 'Waiting on' })
    expect(within(waiting).getByText('everyone has answered')).toBeDefined()
  })
})

describe('past weeks', () => {
  const past = (overrides: Partial<PlannerWeekDto> = {}) =>
    week({ startsOn: '2026-11-16', ...overrides })

  /** The archive is a dropdown at the top now, not a section you scroll to. */
  const pickPastWeek = (value: string) =>
    fireEvent.change(screen.getByRole('combobox', { name: 'Past week' }), {
      target: { value },
    })

  test('the archive is a control next to the week tabs, not a section at the bottom', async () => {
    renderPage()

    await cell('Mon 09:00')
    expect(screen.getByRole('combobox', { name: 'Past week' })).toBeDefined()
    // every week before the window is offered, by date
    expect(screen.getByRole('option', { name: /16–22 Nov/ })).toBeDefined()
    expect(screen.getByRole('option', { name: /26 Oct – 1 Nov/ })).toBeDefined()
    // nothing is loaded until somebody asks for it
    expect(screen.queryByRole('group', { name: 'Everyone’s availability' })).toBeNull()
    expect(apiState.sentWeekParam).toBeUndefined()
  })

  test('picking a past week replaces the live week instead of stacking under it', async () => {
    apiState.plannerWeek = {
      data: past({ answered: ['me', 'u2', 'u3'], unanswered: [] }),
      error: null,
      status: 200,
    }

    renderPage()

    await cell('Tue 20:00')
    pickPastWeek('2026-11-16')

    await waitFor(() => expect(apiState.sentWeekParam).toBe('2026-11-16'))

    expect(await screen.findByText('complete')).toBeDefined()
    expect(screen.getByRole('group', { name: 'Everyone’s availability' })).toBeDefined()
    // the live week's day tabs and its paint grid are gone while a past week is open
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Your availability' })).toBeNull()
    expect(screen.getByText('past week')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Open for editing' })).toBeNull()
  })

  test('"Back to the live week" returns the tabs and the grid I can paint', async () => {
    apiState.plannerWeek = { data: past(), error: null, status: 200 }

    renderPage()

    await cell('Tue 20:00')
    pickPastWeek('2026-11-16')
    fireEvent.click(await screen.findByRole('button', { name: 'Back to the live week' }))

    expect(await screen.findByRole('tab', { name: /This week · / })).toBeDefined()
    expect(await screen.findByRole('group', { name: 'Your availability' })).toBeDefined()
    expect(pressed('Tue 20:00')).toBe('true')
  })

  test('the live week’s own controls disappear while a past week is open', async () => {
    apiState.me = { data: { ...me, role: 'captain' }, error: null, status: 200 }
    apiState.plannerWeek = { data: past(), error: null, status: 200 }

    renderPage()

    await cell('Tue 20:00')
    // both belong to the live week: they would change nothing about the week on screen
    expect(screen.getByRole('button', { name: 'Earlier week' })).toBeDefined()
    expect(screen.getByRole('radio', { name: 'My regular times' })).toBeDefined()

    pickPastWeek('2026-11-16')

    // the window controls are gone; the captain panel above is the archive's own ("Captain only")
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Earlier week' })).toBeNull())
    expect(screen.queryByRole('button', { name: 'Back to this week' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'My regular times' })).toBeNull()
  })

  test('returning to the live week brings them back', async () => {
    apiState.me = { data: { ...me, role: 'captain' }, error: null, status: 200 }
    apiState.plannerWeek = { data: past(), error: null, status: 200 }

    renderPage()

    await cell('Tue 20:00')
    pickPastWeek('2026-11-16')
    fireEvent.click(await screen.findByRole('button', { name: 'Back to the live week' }))

    expect(await screen.findByRole('button', { name: 'Earlier week' })).toBeDefined()
    expect(screen.getByRole('radio', { name: 'My regular times' })).toBeDefined()
  })

  test('"Back to the live week" is a primary button, not a third ghost', async () => {
    apiState.plannerWeek = { data: past(), error: null, status: 200 }

    renderPage()

    await cell('Tue 20:00')
    pickPastWeek('2026-11-16')

    const back = await screen.findByRole('button', { name: 'Back to the live week' })
    // leaving history is the point of being here; it must not read like a footnote
    expect(back.getAttribute('data-variant')).toBe('filled')
  })

  test('a captain sees the archive controls as a captain-only block, with what they do', async () => {
    apiState.me = { data: { ...me, role: 'captain' }, error: null, status: 200 }
    apiState.plannerWeek = { data: past(), error: null, status: 200 }

    renderPage()

    await cell('Tue 20:00')
    pickPastWeek('2026-11-16')

    const panel = await screen.findByRole('group', { name: 'Captain controls for a past week' })
    expect(within(panel).getByText('Captain only')).toBeDefined()
    expect(within(panel).getByText(/reopen/i)).toBeDefined()
    expect(within(panel).getByRole('button', { name: 'Open for editing' })).toBeDefined()
  })

  test('a member sees no archive controls at all', async () => {
    apiState.plannerWeek = { data: past(), error: null, status: 200 }

    renderPage()

    await cell('Tue 20:00')
    pickPastWeek('2026-11-16')

    expect(await screen.findByText('past week')).toBeDefined()
    expect(screen.queryByText('Captain only')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open for editing' })).toBeNull()
  })

  test('a captain opens a finished week for writing', async () => {
    apiState.me = { data: { ...me, role: 'captain' }, error: null, status: 200 }
    apiState.plannerWeek = { data: past(), error: null, status: 200 }

    renderPage()

    await cell('Tue 20:00')
    pickPastWeek('2026-11-16')
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

    await cell('Tue 20:00')
    pickPastWeek('2026-11-16')

    expect(await screen.findByText('open for edits')).toBeDefined()
    expect(await screen.findByRole('button', { name: 'Close week' })).toBeDefined()
    // the live board is not rendered behind it, so this is the only save on screen
    expect(screen.getAllByRole('button', { name: 'Save my week' })).toHaveLength(1)
  })
})

describe('my regular times', () => {
  test('the week tabs are gone while my regular times are open', async () => {
    renderPage()

    await cell('Mon 09:00')
    expect(screen.getAllByRole('tab')).toHaveLength(2)

    fireEvent.click(await screen.findByRole('radio', { name: 'My regular times' }))
    await screen.findByLabelText('Regular times grid')

    // a standing schedule belongs to no week, so "which week" is not a question here
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.queryByText('now')).toBeNull()
    // the archive is still reachable, it is not about this week either
    expect(screen.getByRole('combobox', { name: 'Past week' })).toBeDefined()
  })

  test('the tabs come back with my availability', async () => {
    renderPage()

    await cell('Mon 09:00')
    fireEvent.click(await screen.findByRole('radio', { name: 'My regular times' }))
    await screen.findByLabelText('Regular times grid')
    fireEvent.click(screen.getByRole('radio', { name: 'My availability' }))

    expect(await screen.findByRole('tab', { name: /This week · / })).toBeDefined()
    expect(screen.getAllByRole('tab')).toHaveLength(2)
  })

  const editor = () => within(screen.getByLabelText('Regular times grid'))

  const openEditor = async () => {
    fireEvent.click(await screen.findByRole('radio', { name: 'My regular times' }))
    await screen.findByRole('button', { name: 'Save my regular times' })
  }

  test('it is a third view of the week, not a section under the grid', async () => {
    renderPage()

    await cell('Mon 09:00')
    fireEvent.click(await screen.findByRole('radio', { name: 'My regular times' }))

    expect(await screen.findByLabelText('Regular times grid')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Save my regular times' })).toBeDefined()
    // the week's own grid is replaced, not pushed down
    expect(screen.queryByRole('group', { name: 'Your availability' })).toBeNull()
  })

  test('switching back leaves it behind and saves nothing', async () => {
    renderPage()

    await cell('Mon 09:00')
    fireEvent.click(await screen.findByRole('radio', { name: 'My regular times' }))
    await screen.findByLabelText('Regular times grid')

    fireEvent.click(screen.getByRole('radio', { name: 'My availability' }))

    expect(await screen.findByRole('group', { name: 'Your availability' })).toBeDefined()
    expect(screen.queryByLabelText('Regular times grid')).toBeNull()
    expect(apiState.sentPlannerTemplate).toBeUndefined()
  })

  test('the save row sits above the grid, exactly as it does on my availability', async () => {
    renderPage()

    await cell('Mon 09:00')
    // on the week: the row is above the grid it saves
    const weekSave = screen.getByRole('button', { name: 'Save my week' })
    const weekGrid = screen.getByRole('group', { name: 'Your availability' })
    expect(weekSave.compareDocumentPosition(weekGrid)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    fireEvent.click(screen.getByRole('radio', { name: 'My regular times' }))

    const save = await screen.findByRole('button', { name: 'Save my regular times' })
    const grid = screen.getByLabelText('Regular times grid')
    expect(save.compareDocumentPosition(grid)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

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

  test('the standing schedule autosaves, and undo survives the save', async () => {
    renderPage()
    await openEditor()

    const thursday = () => editor().getByRole('button', { name: 'Thu 21:00' })
    fireEvent.pointerDown(thursday())
    await waitFor(() => expect(thursday().getAttribute('aria-pressed')).toBe('true'))

    await waitFor(() => expect(apiState.sentPlannerTemplate).toBeDefined(), { timeout: 3000 })
    // a clean grid disables Save, but the last gesture is still undoable
    expect(
      screen.getByRole('button', { name: 'Save my regular times' }).hasAttribute('disabled'),
    ).toBe(true)
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(
      () => {
        const latest = apiState.sentPlannerTemplate as {
          days: { intervals: { start: number; end: number }[] }[]
        }
        expect(latest.days[3]?.intervals).toEqual([])
      },
      { timeout: 3000 },
    )
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
