import { describe, expect, test } from 'bun:test'
import { POOL_CAP, validatePoolWrite } from '@lol/shared'
import {
  addChampion,
  moveAcross,
  moveWithin,
  removeChampion,
} from '../../../src/lib/pools/pool-edit.ts'

/**
 * What the page does to a pool *before* it sends it (champion-pools.md §6, §7).
 *
 * These are the decisions that used to be prose in the doc: a champion belongs to one pool section
 * (main **or** situational) but may also be blind-pickable, and adding is an append at the end
 * because the order is the priority. Getting any of them wrong is invisible until the write comes
 * back 422 — or worse, until it succeeds with a pool nobody meant.
 */

const empty = { main: [], situational: [], blind: [] }

describe('addChampion', () => {
  test('appends at the end: the newest addition is the last answer, not the first', () => {
    const lists = addChampion({ ...empty, main: [1, 2] }, 'main', 3)
    expect(lists.main).toEqual([1, 2, 3])
  })

  test('the champion already in that list is a no-op, not a duplicate', () => {
    expect(addChampion({ ...empty, main: [1, 2] }, 'main', 2).main).toEqual([1, 2])
  })

  test('adding to situational takes the champion out of the main pool', () => {
    const lists = addChampion({ ...empty, main: [1, 2], situational: [3] }, 'situational', 1)
    expect(lists.main).toEqual([2])
    expect(lists.situational).toEqual([3, 1])
  })

  test('adding to main takes the champion out of situational', () => {
    const lists = addChampion({ ...empty, situational: [4, 5] }, 'main', 5)
    expect(lists.main).toEqual([5])
    expect(lists.situational).toEqual([4])
    // and the result is a write the API accepts — the local rule and the shared one agree
    expect(validatePoolWrite(lists)).toEqual([])
  })

  test('blind may hold a champion that is also in a pool section', () => {
    const lists = addChampion({ ...empty, main: [1] }, 'blind', 1)
    expect(lists).toEqual({ main: [1], situational: [], blind: [1] })
    expect(validatePoolWrite(lists)).toEqual([])
  })

  test('the cap is the shared one, and the list is left alone at it', () => {
    const full = Array.from({ length: POOL_CAP }, (_, index) => index + 1)
    expect(addChampion({ ...empty, main: full }, 'main', 99).main).toEqual(full)
    expect(addChampion({ ...empty, main: full.slice(1) }, 'main', 99).main).toHaveLength(POOL_CAP)
  })

  test('the input is never mutated', () => {
    const lists = { ...empty, main: [1] }
    addChampion(lists, 'main', 2)
    expect(lists.main).toEqual([1])
  })
})

describe('removeChampion', () => {
  test('removes from that list only — the same id may stay blind-pickable', () => {
    const lists = removeChampion({ ...empty, main: [1, 2], blind: [1] }, 'main', 1)
    expect(lists).toEqual({ main: [2], situational: [], blind: [1] })
  })

  test('removing something that is not there changes nothing', () => {
    expect(removeChampion({ ...empty, main: [1] }, 'main', 9).main).toEqual([1])
  })
})

describe('moveWithin', () => {
  test('reorders inside one list', () => {
    expect(moveWithin({ ...empty, main: [1, 2, 3] }, 'main', 0, 2).main).toEqual([2, 3, 1])
  })

  test('the end of the list is not a move', () => {
    expect(moveWithin({ ...empty, main: [1, 2] }, 'main', 1, 1).main).toEqual([1, 2])
    expect(moveWithin({ ...empty, main: [1, 2] }, 'main', 0, 5).main).toEqual([1, 2])
  })
})

describe('moveAcross', () => {
  test('main -> situational keeps the champion once', () => {
    const lists = moveAcross({ ...empty, main: [1, 2] }, 'main', 1, 'situational')
    expect(lists.main).toEqual([2])
    expect(lists.situational).toEqual([1])
  })

  test('main -> blind leaves the pool section alone: blind is not a pool', () => {
    const lists = moveAcross({ ...empty, main: [1] }, 'main', 1, 'blind')
    expect(lists).toEqual({ main: [1], situational: [], blind: [1] })
  })

  test('moving to the list it is already in is a no-op', () => {
    expect(moveAcross({ ...empty, main: [1] }, 'main', 1, 'main').main).toEqual([1])
  })
})
