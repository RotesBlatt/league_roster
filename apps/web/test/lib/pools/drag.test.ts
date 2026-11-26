import { describe, expect, test } from 'bun:test'
import { emptyPoolLists } from '@lol/shared'
import {
  applyDrop,
  bandDragId,
  championDragId,
  dragMove,
  dropTrash,
  parseDragId,
  TRASH_ID,
} from '../../../src/lib/pools/drag.ts'

/**
 * Dragging a pool entry (champion-pools.md §7).
 *
 * A champion can sit in `main` **and** in `blind`, so a DOM id cannot be the champion id alone: the
 * band is part of the identity, and forgetting that is how "drag its blind copy" silently moves the
 * pool copy instead. The rules that actually move things live in `pool-edit.ts`; this file is the
 * translation from what the pointer dropped on to what the lists become — which is exactly the kind
 * of glue that is wrong forever if it is only ever tested through a mouse.
 */

const empty = emptyPoolLists()

describe('drag ids', () => {
  test('a champion id carries its band', () => {
    expect(championDragId('main', 103)).toBe('chip:main:103')
    expect(championDragId('blind', 103)).not.toBe(championDragId('main', 103))
  })

  test('a band can be a drop target of its own (the empty band case)', () => {
    expect(bandDragId('situational')).toBe('band:situational')
  })

  test('parsing round-trips both shapes', () => {
    expect(parseDragId(championDragId('main', 7))).toEqual({ kind: 'main', championId: 7 })
    expect(parseDragId(bandDragId('blind'))).toEqual({ kind: 'blind', championId: null })
  })

  test('anything else is not a target, rather than a crash or a half-match', () => {
    expect(parseDragId('chip:')).toBeNull()
    expect(parseDragId('chip:extra:1')).toBeNull()
    expect(parseDragId('chip:main:abc')).toBeNull()
    expect(parseDragId('band:')).toBeNull()
    expect(parseDragId('something-else')).toBeNull()
  })
})

describe('dragMove', () => {
  test('dropping on another champion in the same band reorders to that index', () => {
    const lists = { ...empty, main: [1, 2, 3] }
    expect(dragMove(lists, championDragId('main', 3), championDragId('main', 1)).main).toEqual([
      3, 1, 2,
    ])
  })

  test('dropping on a champion in another pool section inserts there and leaves the first', () => {
    const lists = { ...empty, main: [1, 2], situational: [3, 4] }
    const next = dragMove(lists, championDragId('main', 2), championDragId('situational', 4))
    expect(next.main).toEqual([1])
    expect(next.situational).toEqual([3, 2, 4])
  })

  test('dropping on an empty band appends there', () => {
    const lists = { ...empty, main: [1, 2] }
    expect(dragMove(lists, championDragId('main', 1), bandDragId('situational'))).toEqual({
      ...empty,
      main: [2],
      situational: [1],
    })
  })

  test('the learning band is a drop target, and dropping on it is an addition', () => {
    const lists = { ...empty, main: [1, 2] }
    const next = dragMove(lists, championDragId('main', 2), bandDragId('wip'))
    // the pool keeps the champion: wanting to learn it does not take it off the pool
    expect(next.main).toEqual([1, 2])
    expect(next.wip).toEqual([2])
  })

  test('dropping on a learning chip lands at that position, and still adds', () => {
    const lists = { ...empty, main: [1], wip: [5, 6] }
    const next = dragMove(lists, championDragId('main', 1), championDragId('wip', 6))
    expect(next.wip).toEqual([5, 1, 6])
    expect(next.main).toEqual([1])
  })

  test('dragging a learning chip into a pool section takes it out of the learning list', () => {
    const lists = { ...empty, wip: [5, 6] }
    const next = dragMove(lists, championDragId('wip', 6), bandDragId('main'))
    expect(next.main).toEqual([6])
    expect(next.wip).toEqual([5])
  })

  test('dropping a pool champion into blind keeps it in its pool section (§6)', () => {
    const lists = { ...empty, main: [1, 2] }
    const next = dragMove(lists, championDragId('main', 2), bandDragId('blind'))
    expect(next.main).toEqual([1, 2])
    expect(next.blind).toEqual([2])
  })

  test('dropping a champion onto itself, or on nothing, changes nothing', () => {
    const lists = { ...empty, main: [1, 2] }
    expect(dragMove(lists, championDragId('main', 1), championDragId('main', 1))).toEqual(lists)
    expect(dragMove(lists, championDragId('main', 1), null)).toEqual(lists)
    // an id that is not ours must not throw on the way to the server
    expect(dragMove(lists, 'chip:extra:1', championDragId('main', 2))).toEqual(lists)
  })

  test('the input is never mutated', () => {
    const lists = { ...empty, main: [1, 2] }
    dragMove(lists, championDragId('main', 1), bandDragId('situational'))
    expect(lists).toEqual({ ...empty, main: [1, 2] })
  })
})

describe('dropTrash', () => {
  test('the trash is a target with an id of its own, so a drop can be told apart', () => {
    expect(TRASH_ID).toBe('trash')
  })

  test('throwing a champion away removes it from the band it was grabbed in', () => {
    const lists = { ...empty, main: [1, 2, 3] }
    expect(dropTrash(lists, championDragId('main', 2))).toEqual({ ...empty, main: [1, 3] })
  })

  test('the learning copy can be thrown away without touching the pool copy', () => {
    const lists = { ...empty, main: [7], wip: [7] }
    expect(dropTrash(lists, championDragId('wip', 7))).toEqual({ ...empty, main: [7] })
  })

  test('the band in the id decides, so a blind copy can go without touching the pool', () => {
    // the same champion sits in main and in blind: dragging the blind chip discards only that copy
    const lists = { ...empty, main: [7], blind: [7] }
    expect(dropTrash(lists, championDragId('blind', 7))).toEqual({ ...empty, main: [7] })
  })

  test('a band id, or anything not ours, is not a champion to throw away', () => {
    const lists = { ...empty, main: [1] }
    expect(dropTrash(lists, bandDragId('main'))).toEqual(lists)
    expect(dropTrash(lists, 'chip:extra:1')).toEqual(lists)
    expect(dropTrash(lists, null)).toEqual(lists)
  })

  test('throwing away a champion that is not there changes nothing', () => {
    const lists = { ...empty, main: [1] }
    expect(dropTrash(lists, championDragId('main', 9))).toEqual(lists)
  })

  test('the input is never mutated', () => {
    const lists = { ...empty, main: [1, 2] }
    dropTrash(lists, championDragId('main', 1))
    expect(lists.main).toEqual([1, 2])
  })
})

describe('applyDrop', () => {
  test('the trash wins over everything else', () => {
    const lists = { ...empty, main: [1, 2] }
    expect(applyDrop(lists, championDragId('main', 1), TRASH_ID)).toEqual({
      ...empty,
      main: [2],
    })
  })

  test('anything else is a landing spot', () => {
    const lists = { ...empty, main: [1, 2] }
    expect(applyDrop(lists, championDragId('main', 1), championDragId('main', 2)).main).toEqual([
      2, 1,
    ])
  })

  test('dropped outside every target: unchanged, so nothing is written', () => {
    const lists = { ...empty, main: [1] }
    expect(applyDrop(lists, championDragId('main', 1), null)).toEqual(lists)
  })
})
