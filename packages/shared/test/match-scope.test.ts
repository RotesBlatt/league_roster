import { describe, expect, test } from 'bun:test'
import { MATCH_KINDS } from '../src/match.ts'
import { classifyQueue, scopeQueueFilter } from '../src/match-stats.ts'

/**
 * A scope has to become a SQL predicate (match-history.md §5, §8.1).
 *
 * The reason this is a function and not a `switch` inside the query: the day the two disagree, the
 * page shows "Flex" games that the winrate below it did not count — a half-applied filter, which
 * reads as a data bug. The round-trip test at the bottom is what keeps the table honest.
 */

describe('scopeQueueFilter', () => {
  test('"all" is no filter at all, not a list of every id', () => {
    // an ever-growing IN list would silently drop the queue Riot ships next month
    expect(scopeQueueFilter('all')).toEqual({ kind: 'all' })
  })

  test('each ranked scope maps to exactly its queue id', () => {
    expect(scopeQueueFilter('solo')).toEqual({ kind: 'queues', queueIds: [420] })
    expect(scopeQueueFilter('flex')).toEqual({ kind: 'queues', queueIds: [440] })
    expect(scopeQueueFilter('ranked5')).toEqual({ kind: 'queues', queueIds: [710] })
  })

  test('normal is both draft and blind', () => {
    expect(scopeQueueFilter('normal')).toEqual({ kind: 'queues', queueIds: [400, 430] })
  })

  test('custom is queue id 0', () => {
    expect(scopeQueueFilter('custom')).toEqual({ kind: 'queues', queueIds: [0] })
  })

  test('the three that are NOT in Riot’s queue id say so, instead of pretending', () => {
    // tournament and scrim are a membership row and a human tag; "other" is the *absence* of a
    // known id. Filtering any of them by queueId would return the wrong games, confidently.
    expect(scopeQueueFilter('tournament')).toEqual({ kind: 'tagged' })
    expect(scopeQueueFilter('scrim')).toEqual({ kind: 'tagged' })
    expect(scopeQueueFilter('other')).toEqual({ kind: 'tagged' })
  })
})

describe('the table cannot drift from the classifier', () => {
  test('every id a scope claims actually classifies into that scope', () => {
    for (const kind of MATCH_KINDS) {
      const filter = scopeQueueFilter(kind)
      if (filter.kind !== 'queues') continue
      for (const queueId of filter.queueIds) {
        expect(classifyQueue(queueId, 'MATCHED_GAME')).toBe(kind)
      }
    }
  })

  test('every queue id the classifier knows is claimed by a scope', () => {
    // the other direction: a queue that classifies into a kind which no scope filter can produce
    // would be a game that exists and is invisible to every tab
    const claimed = new Set(
      MATCH_KINDS.flatMap((kind) => {
        const filter = scopeQueueFilter(kind)
        return filter.kind === 'queues' ? filter.queueIds : []
      }),
    )
    for (const queueId of [0, 400, 420, 430, 440, 710]) {
      expect(claimed.has(queueId)).toBe(true)
    }
  })
})
