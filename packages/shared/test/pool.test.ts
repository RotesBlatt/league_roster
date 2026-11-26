import { describe, expect, test } from 'bun:test'
import {
  canEditPool,
  emptyPoolLists,
  moveEntry,
  POOL_CAP,
  POOL_KIND_LABELS,
  POOL_KINDS,
  validatePoolWrite,
} from '../src/pool.ts'

/**
 * The pool's rules (champion-pools.md §5, §6, §8). Everything here is plain data in, plain data
 * out — no DB, no HTTP — because these are the three places the feature can be wrong quietly.
 */

describe('canEditPool', () => {
  const me = { id: 'u1', role: 'captain' as const }

  test('you may edit your own pool', () => {
    expect(canEditPool(me, 'u1')).toBe(true)
  })

  test("a captain may not edit a teammate's pool — intent is not a typo", () => {
    expect(canEditPool(me, 'u2')).toBe(false)
  })

  test('a plain member may not edit someone else', () => {
    expect(canEditPool({ id: 'u2', role: 'member' }, 'u1')).toBe(false)
  })

  test('no identity, no pool', () => {
    expect(canEditPool(null, 'u1')).toBe(false)
  })
})

describe('moveEntry', () => {
  test('moves forward: [A,B,C] with 0 -> 2 is [B,C,A]', () => {
    expect(moveEntry(['A', 'B', 'C'], 0, 2)).toEqual(['B', 'C', 'A'])
  })

  test('moves backward: [A,B,C] with 2 -> 0 is [C,A,B]', () => {
    expect(moveEntry(['A', 'B', 'C'], 2, 0)).toEqual(['C', 'A', 'B'])
  })

  test('a one-step move swaps neighbours', () => {
    expect(moveEntry(['A', 'B', 'C'], 0, 1)).toEqual(['B', 'A', 'C'])
  })

  test('same index changes nothing', () => {
    expect(moveEntry(['A', 'B', 'C'], 1, 1)).toEqual(['A', 'B', 'C'])
  })

  test('out of range is a no-op, not a truncation', () => {
    expect(moveEntry(['A', 'B'], -1, 1)).toEqual(['A', 'B'])
    expect(moveEntry(['A', 'B'], 0, 2)).toEqual(['A', 'B'])
    expect(moveEntry(['A', 'B'], 0, 0.5)).toEqual(['A', 'B'])
  })

  test('the input list is never mutated', () => {
    const list = ['A', 'B', 'C']
    moveEntry(list, 2, 0)
    expect(list).toEqual(['A', 'B', 'C'])
  })

  test('an empty list stays empty', () => {
    expect(moveEntry([], 0, 0)).toEqual([])
  })
})

describe('validatePoolWrite', () => {
  test('an empty pool is a valid statement', () => {
    expect(validatePoolWrite(emptyPoolLists())).toEqual([])
  })

  test('the same champion twice in one list is rejected', () => {
    const problems = validatePoolWrite({ ...emptyPoolLists(), main: [1, 2, 1] })
    expect(problems).toHaveLength(1)
    expect(problems[0]?.field).toBe('main')
  })

  test('main and situational are mutually exclusive', () => {
    const problems = validatePoolWrite({ ...emptyPoolLists(), main: [1], situational: [1] })
    expect(problems).toHaveLength(1)
    expect(problems[0]?.field).toBe('situational')
  })

  test('blind may repeat anything — that is the point of it', () => {
    const problems = validatePoolWrite({
      ...emptyPoolLists(),
      main: [1, 2],
      situational: [3],
      blind: [1, 2, 3],
    })
    expect(problems).toEqual([])
  })

  test('the same champion twice in blind is still rejected', () => {
    expect(validatePoolWrite({ ...emptyPoolLists(), blind: [5, 5] })).toHaveLength(1)
  })

  test('exactly the cap is fine', () => {
    const atCap = Array.from({ length: POOL_CAP }, (_, index) => index + 1)
    expect(validatePoolWrite({ ...emptyPoolLists(), main: atCap })).toEqual([])
  })

  test('one over the cap is rejected, naming the kind', () => {
    const tooMany = Array.from({ length: POOL_CAP + 1 }, (_, index) => index + 1)
    const problems = validatePoolWrite({ ...emptyPoolLists(), main: tooMany })
    expect(problems).toHaveLength(1)
    expect(problems[0]?.field).toBe('main')
    expect(problems[0]?.message).toContain(String(POOL_CAP))
  })

  test('a champion id must be a positive integer', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(validatePoolWrite({ ...emptyPoolLists(), main: [bad] })).toHaveLength(1)
    }
  })

  test('a champion the dump does not know is still allowed — ids are not validated', () => {
    // §10.8: never reject a write because a patch moved a champion away.
    expect(validatePoolWrite({ ...emptyPoolLists(), main: [999_999] })).toEqual([])
  })

  test('every kind is validated, not just main', () => {
    expect(validatePoolWrite({ ...emptyPoolLists(), situational: [1, 1] })).toHaveLength(1)
    expect(validatePoolWrite({ ...emptyPoolLists(), blind: [1, 1] })).toHaveLength(1)
  })
})

/**
 * The fourth list: champions a player *wants to learn* (champion-pools.md §6, amended 2026-11-26).
 *
 * It is a `kind` rather than a flag because it is the same thing as the other three — an ordered set
 * of champion ids owned by one person — and it differs only in where it is drawn (last, behind a
 * divider) and in what it means for exclusivity: learning overlaps everything, because the whole
 * promise of the list is "I want to add Yone, I have not played it yet".
 */
describe('the wip list', () => {
  test('is called Learning on screen, and sorts last so the page can divide it off', () => {
    expect(POOL_KIND_LABELS.wip).toBe('Learning')
    expect(POOL_KINDS[POOL_KINDS.length - 1]).toBe('wip')
  })

  test('a champion may be a main pick and still be learning another copy of the idea', () => {
    // overlap is not an accident here: promotion is "it is in main now", not "delete then re-add"
    expect(validatePoolWrite({ ...emptyPoolLists(), main: [1], wip: [1] })).toEqual([])
  })

  test('overlaps situational and blind as well', () => {
    expect(
      validatePoolWrite({
        main: [],
        situational: [2],
        blind: [2],
        wip: [2],
      }),
    ).toEqual([])
  })

  test('the same champion twice inside wip is still rejected', () => {
    const problems = validatePoolWrite({ ...emptyPoolLists(), wip: [9, 9] })
    expect(problems).toHaveLength(1)
    expect(problems[0]?.field).toBe('wip')
  })

  test('wip has the same cap as the other lists', () => {
    const tooMany = Array.from({ length: POOL_CAP + 1 }, (_, index) => index + 1)
    expect(validatePoolWrite({ ...emptyPoolLists(), wip: tooMany })).toHaveLength(1)
  })

  test('an empty wip list is a valid statement', () => {
    expect(emptyPoolLists().wip).toEqual([])
  })
})

describe('emptyPoolLists', () => {
  test('has one empty list per kind, and a fresh array each call', () => {
    const first = emptyPoolLists()
    expect(Object.keys(first).sort()).toEqual([...POOL_KINDS].sort())
    for (const kind of POOL_KINDS) expect(first[kind]).toEqual([])

    first.main.push(1)
    expect(emptyPoolLists().main).toEqual([])
  })
})
