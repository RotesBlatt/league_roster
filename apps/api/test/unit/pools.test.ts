import { describe, expect, test } from 'bun:test'
import type { PoolEntryRow, PoolRow } from '../../src/db/schema.ts'
import type { PoolRosterPerson } from '../../src/lib/pools.ts'
import { composePools } from '../../src/lib/pools.ts'

/**
 * The pool read model (champion-pools.md §7, §11). Pure: roster rows in, DTO rows out.
 *
 * The failure this is written against is the quiet one — a player who never filled a pool
 * disappearing from the page, or an order that only looks right because the query happened to
 * return it that way.
 */

const person = (
  userId: string,
  displayName: string,
  role: PoolRosterPerson['role'] = null,
): PoolRosterPerson => ({ userId, displayName, role, isActive: true })

const header = (ownerId: string, overrides: Partial<PoolRow> = {}): PoolRow => ({
  ownerId,
  version: 3,
  updatedAt: new Date('2026-11-20T19:00:00Z'),
  ...overrides,
})

let nextId = 0
const nextEntryId = () => {
  nextId += 1
  return `e${nextId}`
}

const entry = (
  ownerId: string,
  kind: PoolEntryRow['kind'],
  championId: number,
  position: number,
): PoolEntryRow => ({
  id: nextEntryId(),
  ownerId,
  kind,
  championId,
  position,
  createdAt: new Date('2026-11-20T19:00:00Z'),
  updatedAt: new Date('2026-11-20T19:00:00Z'),
})

describe('composePools', () => {
  test('a player who never saved a pool is present with version 0 and four empty lists', () => {
    const dto = composePools({ roster: [person('u1', 'Jan', 'TOP')], pools: [], entries: [] })

    expect(dto).toHaveLength(1)
    expect(dto[0]).toEqual({
      userId: 'u1',
      displayName: 'Jan',
      role: 'TOP',
      isActive: true,
      version: 0,
      updatedAt: null,
      lists: { main: [], situational: [], blind: [], wip: [] },
    })
  })

  test('the roster order is the response order, whatever the pool rows say', () => {
    const dto = composePools({
      roster: [person('u2', 'Ben'), person('u1', 'Jan')],
      pools: [header('u1')],
      entries: [],
    })

    expect(dto.map((row: { displayName: string }) => row.displayName)).toEqual(['Ben', 'Jan'])
  })

  test('lists come out in position order even when the rows arrive shuffled', () => {
    const dto = composePools({
      roster: [person('u1', 'Jan')],
      pools: [header('u1')],
      entries: [
        entry('u1', 'main', 101, 2),
        entry('u1', 'main', 17, 0),
        entry('u1', 'main', 64, 1),
      ],
    })

    expect(dto[0]?.lists.main).toEqual([17, 64, 101])
  })

  test('the four kinds stay apart, and each keeps its own order', () => {
    const dto = composePools({
      roster: [person('u1', 'Jan')],
      pools: [header('u1')],
      entries: [
        entry('u1', 'blind', 1, 0),
        entry('u1', 'situational', 2, 0),
        entry('u1', 'main', 3, 0),
        entry('u1', 'blind', 4, 1),
      ],
    })

    expect(dto[0]?.lists).toEqual({ main: [3], situational: [2], blind: [1, 4], wip: [] })
  })

  test('a cleared pool keeps its version and timestamp — it was touched, and that is information', () => {
    const dto = composePools({
      roster: [person('u1', 'Jan')],
      pools: [header('u1', { version: 7 })],
      entries: [],
    })

    expect(dto[0]?.version).toBe(7)
    expect(dto[0]?.updatedAt).toBe(new Date('2026-11-20T19:00:00Z').getTime())
    expect(dto[0]?.lists).toEqual({ main: [], situational: [], blind: [], wip: [] })
  })

  test('a pool whose owner left the roster is not rendered', () => {
    const dto = composePools({
      roster: [person('u1', 'Jan')],
      pools: [header('u1'), header('gone')],
      entries: [entry('gone', 'main', 1, 0)],
    })

    expect(dto).toHaveLength(1)
    expect(dto[0]?.userId).toBe('u1')
    expect(dto[0]?.lists.main).toEqual([])
  })

  test('each person gets their own lists', () => {
    const dto = composePools({
      roster: [person('u1', 'Jan'), person('u2', 'Ben')],
      pools: [header('u1'), header('u2')],
      entries: [entry('u1', 'main', 1, 0), entry('u2', 'main', 2, 0)],
    })

    expect(dto[0]?.lists.main).toEqual([1])
    expect(dto[1]?.lists.main).toEqual([2])
  })
})
