import { describe, expect, test } from 'bun:test'
import type { PoolPersonDto } from '@lol/api/schema-types'
import { emptyPoolLists } from '@lol/shared'
import { hasAnyChampion, poolAgeText, poolCompletion } from '../../../src/lib/pools/pool-view.ts'

/**
 * The pool page's two sentences (champion-pools.md §7): how full the team's pools are, and how old
 * one is. Both are pure so they can be tested without a render, and both have an awkward case that
 * only a test catches — "0 of 0 filled" on an empty team, and "updated 1 days ago".
 */

const empty = emptyPoolLists()

const person = (lists: Partial<PoolPersonDto['lists']> = {}): Pick<PoolPersonDto, 'lists'> => ({
  lists: { ...empty, ...lists },
})

describe('hasAnyChampion', () => {
  test('a never-saved and a cleared pool both count as empty', () => {
    expect(hasAnyChampion(empty)).toBe(false)
  })

  test('any one list being filled is enough', () => {
    expect(hasAnyChampion({ ...empty, main: [1] })).toBe(true)
    expect(hasAnyChampion({ ...empty, situational: [1] })).toBe(true)
    expect(hasAnyChampion({ ...empty, blind: [1] })).toBe(true)
  })

  test('the learning list alone is not a pool — a plan is not something we can draft with', () => {
    expect(hasAnyChampion({ ...empty, wip: [1] })).toBe(false)
  })
})

describe('poolCompletion', () => {
  test('nobody on the roster: no sentence at all', () => {
    expect(poolCompletion([])).toEqual({ filled: 0, total: 0, text: null })
  })

  test('nobody has filled anything yet', () => {
    expect(poolCompletion([person(), person()])).toEqual({
      filled: 0,
      total: 2,
      text: 'no pool filled yet',
    })
  })

  test('some but not all', () => {
    expect(poolCompletion([person({ main: [1] }), person(), person()])).toEqual({
      filled: 1,
      total: 3,
      text: '1 of 3 filled their pool',
    })
  })

  test('when everyone has filled one, there is nothing to chase and nothing is said', () => {
    // a status line for a state nobody has to act on is noise in the same space as the sentence
    // that matters
    expect(poolCompletion([person({ blind: [1] }), person({ main: [2] })])).toEqual({
      filled: 2,
      total: 2,
      text: null,
    })
  })

  test('a one-person team that filled its pool says nothing either', () => {
    expect(poolCompletion([person({ main: [1] })]).text).toBeNull()
  })

  test('a situational-only or blind-only pool counts as filled', () => {
    expect(poolCompletion([person({ situational: [9] })]).filled).toBe(1)
    expect(poolCompletion([person({ blind: [9] })]).filled).toBe(1)
  })

  test('a learner is still chased: learning five champions is not filling a pool', () => {
    // the line means "we can draft with this", so a wip-only pool must keep the sentence visible
    expect(poolCompletion([person({ main: [1] }), person({ wip: [2, 3] })])).toEqual({
      filled: 1,
      total: 2,
      text: '1 of 2 filled their pool',
    })
  })
})

describe('poolAgeText', () => {
  const now = new Date('2026-11-25T12:00:00Z').getTime()
  const ago = (ms: number) => now - ms

  test('never saved has no age to state', () => {
    expect(poolAgeText(null, now)).toBeNull()
  })

  test('under a minute reads "just now", not "0 min ago"', () => {
    expect(poolAgeText(ago(5_000), now)).toBe('updated just now')
  })

  test('minutes, then hours', () => {
    expect(poolAgeText(ago(5 * 60_000), now)).toBe('updated 5 min ago')
    expect(poolAgeText(ago(3 * 3_600_000), now)).toBe('updated 3 h ago')
  })

  test('one day is "yesterday", not "1 days ago"', () => {
    expect(poolAgeText(ago(26 * 3_600_000), now)).toBe('updated yesterday')
  })

  test('a few days stay relative', () => {
    expect(poolAgeText(ago(3 * 86_400_000), now)).toBe('updated 3 days ago')
    expect(poolAgeText(ago(14 * 86_400_000), now)).toBe('updated 14 days ago')
  })

  test('older than two weeks turns into a date, because a bigger number stops meaning anything', () => {
    expect(poolAgeText(ago(20 * 86_400_000), now)).toBe('updated on 05.11.2026')
  })

  test('a timestamp in the future is "just now", not a negative age', () => {
    expect(poolAgeText(now + 60_000, now)).toBe('updated just now')
  })
})
