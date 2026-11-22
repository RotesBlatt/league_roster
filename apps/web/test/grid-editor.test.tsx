import { afterEach, describe, expect, jest, test } from 'bun:test'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AUTOSAVE_DELAY_MS, GridEditor } from '../src/components/planner/GridEditor.tsx'
import { emptyGrid, type Grid } from '../src/lib/planner/availability-grid.ts'

/**
 * One editor for both grids that save: the week's availability and the standing times.
 *
 * They are the same table with the same three buttons above it, so they are the same component —
 * this test is what keeps "the same" from meaning "looks similar today".
 */

afterEach(() => {
  cleanup()
  jest.useRealTimers()
})

const grid = (painted: boolean): Grid => {
  const next = emptyGrid()
  const monday = next[0]
  if (monday) monday[18] = painted
  return next
}

function renderEditor(overrides: Partial<Parameters<typeof GridEditor>[0]> = {}) {
  const calls = { save: 0, undo: 0, begin: 0 }
  const props = {
    label: 'Regular times grid',
    description: 'A week you have not answered yet starts from these times.',
    grid: grid(false),
    onBegin: () => {
      calls.begin++
    },
    onDrag: () => {},
    onEnd: () => {},
    onUndo: () => {
      calls.undo++
    },
    canUndo: true,
    dirty: true,
    saving: false,
    saveLabel: 'Save my regular times',
    onSave: () => {
      calls.save++
    },
    ...overrides,
  }

  render(
    <MantineProvider>
      <GridEditor {...props} />
    </MantineProvider>,
  )

  return calls
}

describe('GridEditor', () => {
  test('the description and both buttons sit above the grid they save', () => {
    renderEditor()

    const save = screen.getByRole('button', { name: 'Save my regular times' })
    const gridEl = screen.getByLabelText('Regular times grid')

    expect(screen.getByText(/starts from these times/)).toBeDefined()
    expect(save.compareDocumentPosition(gridEl)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(screen.getByRole('button', { name: 'Undo' }).compareDocumentPosition(gridEl)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  test('the buttons keep the same weight in both editors: undo de-emphasised, save primary', () => {
    renderEditor()

    // Mantine leaves `data-variant` off for its default (filled), so "primary" is "not subtle"
    expect(screen.getByRole('button', { name: 'Undo' }).getAttribute('data-variant')).toBe('subtle')
    expect(
      screen.getByRole('button', { name: 'Save my regular times' }).getAttribute('data-variant'),
    ).not.toBe('subtle')
  })

  test('nothing to undo means undo is disabled, and nothing to save means save is', () => {
    renderEditor({ canUndo: false, dirty: false })

    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true)
    expect(
      screen.getByRole('button', { name: 'Save my regular times' }).hasAttribute('disabled'),
    ).toBe(true)
  })

  test('the buttons call what they are given, and the grid paints from the grid it is handed', () => {
    const calls = renderEditor({ grid: grid(true), saveLabel: 'Save my week' })

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save my week' }))
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Mon 09:00' }))

    expect(calls.undo).toBe(1)
    expect(calls.save).toBe(1)
    expect(calls.begin).toBe(1)
    expect(screen.getByRole('button', { name: 'Mon 09:00' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
  })

  test('a dirty grid saves itself after a pause, and a clean one never does', () => {
    jest.useFakeTimers()
    const calls = renderEditor({ dirty: true })

    jest.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1)
    expect(calls.save).toBe(0)

    jest.advanceTimersByTime(1)
    expect(calls.save).toBe(1)

    cleanup()
    const clean = renderEditor({ dirty: false })
    jest.advanceTimersByTime(AUTOSAVE_DELAY_MS * 4)
    expect(clean.save).toBe(0)
  })

  test('a dated grid shows the dates; an undated one does not', () => {
    renderEditor({ label: 'Your availability', startsOn: '2026-11-23' })
    // the date under each day head, so "which Tuesday is this?" has an answer
    expect(screen.getByText('23.11')).toBeDefined()

    cleanup()
    renderEditor({ label: 'Regular times grid' })
    expect(screen.queryByText('23.11')).toBeNull()
  })
})
