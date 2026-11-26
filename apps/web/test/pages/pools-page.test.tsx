import { beforeEach, describe, expect, spyOn, test } from 'bun:test'
import type { Me, PoolPersonDto } from '@lol/api/schema-types'
import { emptyPoolLists } from '@lol/shared'
import { MantineProvider } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { apiState, installApiMock, resetApiState } from '../api-mock.ts'

/**
 * The pool page's write half (champion-pools.md §7, §8). What is worth a DOM here — and could not
 * be proven by the pure `pool-edit` / `pool-save` tests — is the **wiring**:
 *
 * - only *my* column gets handles, decided by the shared `canEditPool`;
 * - a menu move changes the draft, and Save sends the whole pool with the version this page read;
 * - a stale `409` drops the draft so the stored pool is shown, instead of overwriting it.
 */
installApiMock()

const { PoolsPage } = await import('../../src/pages/PoolsPage.tsx')

const me: Me = {
  id: 'u1',
  name: 'Me',
  email: 'me@test.local',
  image: null,
  teamId: 't1',
  teamSlug: 'alpha',
  role: 'member',
  status: 'active',
}

const person = (overrides: Partial<PoolPersonDto> = {}): PoolPersonDto => ({
  userId: 'u1',
  displayName: 'Me',
  role: 'TOP',
  isActive: true,
  version: 3,
  // a saved pool always has a header, so it always has an age (only `mate` never saved)
  updatedAt: Date.now() - 3 * 86_400_000,
  lists: { ...emptyPoolLists(), main: [1, 2] },
  ...overrides,
})

const mine = person()
const mate = person({
  userId: 'u2',
  displayName: 'Mate',
  role: 'MID',
  version: 0,
  updatedAt: null,
  lists: emptyPoolLists(),
})

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MantineProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/t/alpha/pools']}>
          <Routes>
            <Route path="/t/:slug/pools" element={<PoolsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  )
}

/**
 * Notifications are spied, not mocked at module level, and never mounted: a real Mantine
 * notification keeps its `autoClose` timer alive, which made the 409 test wait ~9s for nothing.
 * The spy is also the better assertion — "what did the page tell the user" is the behaviour.
 */
let notify: ReturnType<typeof spyOn<typeof notifications, 'show'>>

/** The chips carry `aria-roledescription="sortable"` only in the editable column. */
const sortableChips = () =>
  Array.from(document.querySelectorAll('[aria-roledescription="sortable"]'))

/** The actions are a context menu on the chip now — no corner button to click. */
const openChipMenu = (index = 0) => fireEvent.contextMenu(sortableChips()[index]!)

beforeEach(() => {
  resetApiState()
  apiState.me = { data: me, error: null, status: 200 }
  apiState.poolsList = { data: { people: [mine, mate] }, error: null, status: 200 }
  // `show` returns the notification id; nothing reads it here, but the signature is the signature
  notify = spyOn(notifications, 'show').mockImplementation(() => 'test-notification')
})

describe('read', () => {
  test('one column per person, four bands each, and the never-saved column says so', async () => {
    renderPage()

    expect(await screen.findByText('Me')).toBeTruthy()
    expect(screen.getByText('Mate')).toBeTruthy()
    // four band headings per column, two columns; the capitals are CSS (`tt`), not the text
    expect(screen.getAllByText('Main')).toHaveLength(2)
    expect(screen.getAllByText('Situational')).toHaveLength(2)
    expect(screen.getAllByText('Blind-pickable')).toHaveLength(2)
    expect(screen.getAllByText('Learning')).toHaveLength(2)
    // the learning band is divided off, once per column, and nothing else is
    expect(screen.getAllByRole('separator')).toHaveLength(2)
    // the age line distinguishes "never saved" from "saved a while ago"
    expect(screen.getByText('no pool yet')).toBeTruthy()
    // one of two columns is filled
    expect(screen.getByText('1 of 2 filled their pool')).toBeTruthy()
  })
})

describe('how a champion is drawn', () => {
  test('a band is icon-only: the name is the label and the tooltip, never body text', async () => {
    apiState.champions = {
      data: {
        patch: '16.23.1',
        previousPatch: null,
        patchPublishedAt: null,
        fetchedAt: null,
        state: 'current',
        champions: [
          {
            championId: 1,
            name: 'Annie',
            slug: 'annie',
            iconUrl: 'https://cdn/1.png',
            positions: [],
            roles: [],
          },
        ],
      },
      error: null,
      status: 200,
    }

    renderPage()

    // the icon carries the name for hover and assistive tech…
    expect((await screen.findAllByTitle('Annie')).length).toBeGreaterThan(0)
    // …but it is not printed next to it: the chip is the icon
    expect(screen.queryByText('Annie')).toBeNull()
  })
})

describe('editing your own column', () => {
  test('the five role slots are always drawn, empty ones included', async () => {
    renderPage()

    // mine is TOP, the mate is MID, so JGL / ADC / SUP have nobody: three empty slots, not a
    // three-column page that shrinks and grows as people join
    await waitFor(() => expect(screen.getAllByText('no player yet')).toHaveLength(3))
  })

  test('only my column has handles — the others are reads', async () => {
    renderPage()

    // one add button per editable band (Main, Situational, Blind, Learning) = 4, exactly once
    expect(await screen.findAllByLabelText(/^Add a champion to/)).toHaveLength(4)
    // and only my two chips are sortable; the other column's are plain reads
    await waitFor(() => expect(sortableChips()).toHaveLength(2))
  })

  test('the + opens a one-column popover list that searches, and the pick lands in the draft', async () => {
    apiState.champions = {
      data: {
        patch: '16.23.1',
        previousPatch: null,
        patchPublishedAt: null,
        fetchedAt: null,
        state: 'current',
        champions: [
          {
            championId: 103,
            name: 'Ahri',
            slug: 'ahri',
            iconUrl: 'https://cdn/103.png',
            positions: [],
            roles: [],
          },
        ],
      },
      error: null,
      status: 200,
    }

    renderPage()

    fireEvent.click((await screen.findAllByLabelText('Add a champion to Main'))[0]!)
    // a single column list with a search field, not a modal covering the page
    expect(await screen.findByPlaceholderText('Search a champion…')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('Search a champion…'), {
      target: { value: 'ahri' },
    })
    fireEvent.click(await screen.findByText('Ahri'))

    // autosave: no Save button, the pick is written as it is made
    await waitFor(() =>
      expect(apiState.sentPool).toEqual({
        version: 3,
        lists: { ...emptyPoolLists(), main: [1, 2, 103] },
      }),
    )
  })

  test('the chip actions open at the pointer and close when it leaves', async () => {
    renderPage()
    await waitFor(() => expect(sortableChips()).toHaveLength(2))

    fireEvent.contextMenu(sortableChips()[0]!, { clientX: 120, clientY: 80 })

    // the panel is placed from the event's own coordinates — the bug was that it rendered at the
    // page's top-left because it had no measurable anchor
    const menu = await screen.findByRole('menu')
    expect(menu.style.left).toBe('120px')
    expect(menu.style.top).toBe('80px')

    // and it leaves when the pointer does, without needing a click somewhere else
    fireEvent.mouseLeave(menu)
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  test('Escape also closes the chip actions', async () => {
    renderPage()
    await waitFor(() => expect(sortableChips()).toHaveLength(2))

    fireEvent.contextMenu(sortableChips()[0]!)
    expect(await screen.findByRole('menu')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  test('a menu move is written immediately, with the version that was read', async () => {
    renderPage()

    await waitFor(() => expect(sortableChips()).toHaveLength(2))
    openChipMenu()
    fireEvent.click(await screen.findByText('Move down'))

    await waitFor(() =>
      expect(apiState.sentPool).toEqual({
        version: 3,
        lists: { ...emptyPoolLists(), main: [2, 1] },
      }),
    )
  })

  test('a stale version drops the draft instead of overwriting', async () => {
    apiState.poolSave = {
      data: null,
      error: { value: { reason: 'stale', version: 9 } },
      status: 409,
    }

    renderPage()

    await waitFor(() => expect(sortableChips()).toHaveLength(2))
    const readsBefore = apiState.calls.poolsGet
    openChipMenu()
    // the move autosaves, so the 409 arrives without anyone pressing anything
    fireEvent.click(await screen.findByText('Move down'))

    // "showing the latest version" has to be true: the stored pool is read again, not just assumed
    await waitFor(() => expect(apiState.calls.poolsGet).toBeGreaterThan(readsBefore))

    // the user is told whose version won, rather than being left to notice a silent revert
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          color: 'yellow',
          message: expect.stringMatching(/another tab/i),
        }),
      ),
    )

    // and the draft is gone, so the chips are back in the stored order
    // the chip's accessible name is the champion (`role="img"`); the first two must be the stored
    // order again. `getAllByTitle` would double-count: the placeholder icon carries a title too.
    const order = screen
      .getAllByRole('img', { name: /^Champion #/ })
      .slice(0, 2)
      .map((chip) => chip.getAttribute('aria-label'))
    expect(order).toEqual(['Champion #1', 'Champion #2'])
  })
})
