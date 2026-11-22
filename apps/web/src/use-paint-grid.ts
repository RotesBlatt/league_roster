import { useState } from 'react'
import {
  applyGesture,
  type Cell,
  type Gesture,
  type Grid,
  startGesture,
} from './availability-grid.ts'

/**
 * The React side of painting, extracted once because two grids need it: the week I am answering
 * and the standing schedule I open every week with.
 *
 * All the rules still live in `availability-grid.ts` — this hook only holds "what the grid is
 * now", "which gesture is in progress" and the one-step undo grid. Duplicated in two components it
 * would eventually disagree about the undo.
 */
export function usePaintGrid(initial: Grid) {
  const [grid, setGrid] = useState<Grid>(initial)
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const [before, setBefore] = useState<Grid | null>(null)
  /**
   * Changes are counted, not just flagged. Autosave may finish after the painter moved on, and a
   * boolean `dirty` would then swallow the newer change as "saved" — the grid would look clean
   * while the server holds the older version. A revision per change makes that race impossible.
   */
  const [revision, setRevision] = useState(0)
  const [savedRevision, setSavedRevision] = useState(0)

  const changed = () => setRevision((current) => current + 1)

  const begin = (cell: Cell) => {
    const started = startGesture(grid, cell)
    setBefore(grid)
    setGesture(started)
    setGrid(applyGesture(started, cell))
    changed()
  }

  const drag = (cell: Cell) => {
    if (!gesture) return
    setGrid(applyGesture(gesture, cell))
    changed()
  }

  const end = () => setGesture(null)

  const undo = () => {
    if (!before) return
    setGrid(before)
    setBefore(null)
    setGesture(null)
    changed()
  }

  /** Which revision the server acknowledged. Anything painted since then stays dirty. */
  const markSaved = (saved: number) => setSavedRevision((current) => Math.max(current, saved))

  return {
    grid,
    revision,
    dirty: revision > savedRevision,
    canUndo: before !== null,
    begin,
    drag,
    end,
    undo,
    markSaved,
  }
}
