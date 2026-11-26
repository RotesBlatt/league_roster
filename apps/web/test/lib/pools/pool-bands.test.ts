import { describe, expect, test } from 'bun:test'
import { POOL_KINDS } from '@lol/shared'
import { poolBandGroups } from '../../../src/lib/pools/pool-bands.ts'

/**
 * The bands of one pool card, in drawing order (champion-pools.md §7, amended 2026-11-26).
 *
 * Which bands exist is a fact about the model (`POOL_KINDS`) — but **where the divider goes** is a
 * decision, and a divider drawn by hand inside JSX is a decision nobody can test. So the grouping is
 * data: the page renders groups with a rule between them.
 */

describe('poolBandGroups', () => {
  test('the three draftable lists first, the learning list alone and divided below them', () => {
    expect(poolBandGroups()).toEqual([
      { kinds: ['main', 'situational', 'blind'], dividedFromAbove: false },
      { kinds: ['wip'], dividedFromAbove: true },
    ])
  })

  test('every kind is drawn exactly once, so a fifth kind cannot silently disappear', () => {
    const drawn = poolBandGroups().flatMap((group) => group.kinds)

    expect([...drawn].sort()).toEqual([...POOL_KINDS].sort())
    expect(new Set(drawn).size).toBe(drawn.length)
  })

  test('the order inside a group is the model order, not alphabetical', () => {
    expect(poolBandGroups()[0]?.kinds).toEqual(['main', 'situational', 'blind'])
  })

  test('nothing is divided off above the first group — a rule with nothing above it is a border', () => {
    expect(poolBandGroups()[0]?.dividedFromAbove).toBe(false)
  })

  test('without a learning list there is one group and no divider at all', () => {
    expect(poolBandGroups(['main', 'situational', 'blind'])).toEqual([
      { kinds: ['main', 'situational', 'blind'], dividedFromAbove: false },
    ])
  })
})
