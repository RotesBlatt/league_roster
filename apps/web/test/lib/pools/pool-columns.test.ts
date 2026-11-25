import { describe, expect, test } from 'bun:test'
import type { PoolPersonDto } from '@lol/api/schema-types'
import { ROLES } from '@lol/shared'
import { poolColumns } from '../../../src/lib/pools/pool-columns.ts'

/**
 * Which columns the pool page draws (champion-pools.md §7).
 *
 * The page must always have the same five role slots — TOP → SUP — whether or not anyone fills
 * them: an empty column with a role heading says "we have nobody here", while a missing column
 * silently changes the shape of the page and makes people hunt for the role that is gone. Extra
 * people (a second mid, a substitute) get their own column next to their role; people with no role
 * at all come last, because they have no position to sit at.
 */

const person = (
  userId: string,
  displayName: string,
  role: PoolPersonDto['role'],
): PoolPersonDto => ({
  userId,
  displayName,
  role,
  isActive: true,
  version: 0,
  updatedAt: null,
  lists: { main: [], situational: [], blind: [] },
})

describe('poolColumns', () => {
  test('an empty team still has one column per role, in ROLES order', () => {
    const columns = poolColumns([])

    expect(columns.map((column) => column.role)).toEqual([...ROLES])
    expect(columns.every((column) => column.person === null)).toBe(true)
  })

  test('a filled role keeps its slot and the other roles stay as empty columns', () => {
    const columns = poolColumns([person('u1', 'Jan', 'JGL')])

    expect(columns.map((column) => column.role)).toEqual([...ROLES])
    expect(columns[1]?.person?.displayName).toBe('Jan')
    expect(columns.filter((column) => column.person === null)).toHaveLength(4)
  })

  test('two people on one role get one column each, side by side', () => {
    const columns = poolColumns([person('u1', 'Jan', 'MID'), person('u2', 'Ben', 'MID')])

    // TOP, JGL, MID·Jan, MID·Ben, ADC, SUP
    expect(columns.map((column) => [column.role, column.person?.displayName ?? null])).toEqual([
      ['TOP', null],
      ['JGL', null],
      ['MID', 'Jan'],
      ['MID', 'Ben'],
      ['ADC', null],
      ['SUP', null],
    ])
  })

  test('people without a role come after the five roles, in the order they arrived', () => {
    const columns = poolColumns([person('u1', 'Zoe', null), person('u2', 'Amy', 'SUP')])

    expect(columns.map((column) => column.person?.displayName ?? null)).toEqual([
      null, // TOP
      null, // JGL
      null, // MID
      null, // ADC
      'Amy', // SUP
      'Zoe', // no role
    ])
    expect(columns.at(-1)?.role).toBeNull()
  })

  test('the order inside a role is the order it was given — the server already sorted names', () => {
    const columns = poolColumns([person('u2', 'Ben', 'TOP'), person('u1', 'Jan', 'TOP')])

    expect(
      columns.filter((column) => column.role === 'TOP').map((column) => column.person?.displayName),
    ).toEqual(['Ben', 'Jan'])
  })

  test('every person appears exactly once', () => {
    const people = [
      person('u1', 'A', 'TOP'),
      person('u2', 'B', 'ADC'),
      person('u3', 'C', null),
      person('u4', 'D', 'ADC'),
    ]
    const shown = poolColumns(people)
      .map((column) => column.person?.userId)
      .filter((id): id is string => id !== undefined)

    expect(shown.sort()).toEqual(['u1', 'u2', 'u3', 'u4'])
  })
})
