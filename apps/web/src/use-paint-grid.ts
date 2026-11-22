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
  const [dirty, setDirty] = useState(false)

  const begin = (cell: Cell) => {
    const started = startGesture(grid, cell)
    setBefore(grid)
    setGesture(started)
    setGrid(applyGesture(started, cell))
    setDirty(true)
  }

  const drag = (cell: Cell) => {
    if (!gesture) return
    setGrid(applyGesture(gesture, cell))
  }

  const end = () => setGesture(null)

  const undo = () => {
    if (!before) return
    setGrid(before)
    setBefore(null)
    setGesture(null)
    setDirty(true)
  }

  return { grid, dirty, canUndo: before !== null, begin, drag, end, undo }
}
