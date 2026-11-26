import { describe, expect, test } from 'bun:test'
import { emptyPoolLists } from '@lol/shared'
import { chipActions } from '../../../src/lib/pools/chip-actions.ts'

/**
 * The chip's right-click actions (champion-pools.md §7).
 *
 * The list is built here rather than inside the component because *which* actions exist and *which*
 * are disabled is the rule — "no move up on the first chip", "no blind action for a champion that is
 * already blind-pickable", "no pool section to move to from blind". A component that decides this
 * inline is a component whose menu can drift from `pool-edit.ts`.
 */

const empty = emptyPoolLists()

describe('chipActions', () => {
  test('a main chip offers move, move across, blind and remove', () => {
    const actions = chipActions({ ...empty, main: [1, 2] }, 'main', 1, 0)
    expect(actions.map((action) => action.key)).toEqual([
      'up',
      'down',
      'to-other-section',
      'to-blind',
      'remove',
    ])
  })

  test('the first chip cannot move up, the last cannot move down', () => {
    const first = chipActions({ ...empty, main: [1, 2] }, 'main', 1, 0)
    const last = chipActions({ ...empty, main: [1, 2] }, 'main', 2, 1)

    expect(first.find((action) => action.key === 'up')?.disabled).toBe(true)
    expect(first.find((action) => action.key === 'down')?.disabled).toBe(false)
    expect(last.find((action) => action.key === 'down')?.disabled).toBe(true)
  })

  test('a lone chip cannot move at all', () => {
    const actions = chipActions({ ...empty, main: [7] }, 'main', 7, 0)
    expect(actions.find((action) => action.key === 'up')?.disabled).toBe(true)
    expect(actions.find((action) => action.key === 'down')?.disabled).toBe(true)
  })

  test('the cross-section label names the other pool section', () => {
    expect(
      chipActions({ ...empty, main: [1] }, 'main', 1, 0).find(
        (action) => action.key === 'to-other-section',
      )?.label,
    ).toBe('Move to Situational')

    expect(
      chipActions({ ...empty, situational: [1] }, 'situational', 1, 0).find(
        (action) => action.key === 'to-other-section',
      )?.label,
    ).toBe('Move to Main')
  })

  test('blind has nowhere to move across to, and no blind action of its own', () => {
    const keys = chipActions({ ...empty, blind: [1] }, 'blind', 1, 0).map((action) => action.key)
    expect(keys).toEqual(['up', 'down', 'remove'])
  })

  test('a learning chip has no section to move across to, but can still become blind', () => {
    const keys = chipActions({ ...empty, wip: [1] }, 'wip', 1, 0).map((action) => action.key)
    expect(keys).toEqual(['up', 'down', 'to-blind', 'remove'])
  })

  test('adding a learning champion to blind is an addition: it stays in the learning list', () => {
    const lists = { ...empty, wip: [1, 2] }
    const blind = chipActions(lists, 'wip', 1, 0).find((action) => action.key === 'to-blind')
    expect(blind?.apply()).toEqual({ ...empty, wip: [1, 2], blind: [1] })
  })

  test('a champion that is already blind-pickable offers no blind action', () => {
    const keys = chipActions({ ...empty, main: [1], blind: [1] }, 'main', 1, 0).map(
      (action) => action.key,
    )
    expect(keys).not.toContain('to-blind')
  })

  test('apply() produces the lists the action means', () => {
    const lists = { ...empty, main: [1, 2] }
    const down = chipActions(lists, 'main', 1, 0).find((action) => action.key === 'down')
    expect(down?.apply()).toEqual({ ...empty, main: [2, 1] })

    const blind = chipActions(lists, 'main', 1, 0).find((action) => action.key === 'to-blind')
    // into blind is an addition: the champion stays in main
    expect(blind?.apply()).toEqual({ ...empty, main: [1, 2], blind: [1] })

    const remove = chipActions(lists, 'main', 1, 0).find((action) => action.key === 'remove')
    expect(remove?.apply()).toEqual({ ...empty, main: [2] })
  })

  test('remove is the destructive one, so it is marked as such', () => {
    const remove = chipActions({ ...empty, main: [1] }, 'main', 1, 0).find(
      (action) => action.key === 'remove',
    )
    expect(remove?.danger).toBe(true)
    expect(remove?.disabled).toBe(false)
  })
})
