import { POOL_KIND_LABELS, type PoolKind, type PoolLists } from '@lol/shared'
import { moveAcross, moveWithin, removeChampion } from './pool-edit.ts'

/**
 * What the chip's right-click offers (champion-pools.md §7), as data.
 *
 * The rules are not in the component: "no move up on the first chip", "no blind action for a
 * champion that is already blind-pickable", "blind has no section to move across to" are decisions,
 * and a menu that decides them inline can drift away from `pool-edit.ts`. Each action carries the
 * lists it *would* produce, so the component only has to render and call `apply`.
 */

export type ChipActionKey = 'up' | 'down' | 'to-other-section' | 'to-blind' | 'remove'

/** Where "move across" goes: the two pool sections swap, and `blind` has nowhere to go (§6). */
const OTHER_SECTION: Record<PoolKind, PoolKind | null> = {
  main: 'situational',
  situational: 'main',
  blind: null,
}

export type ChipAction = {
  key: ChipActionKey
  label: string
  disabled: boolean
  /** Destructive styling for the one action that throws something away. */
  danger?: boolean
  apply: () => PoolLists
}

export function chipActions(
  lists: PoolLists,
  kind: PoolKind,
  championId: number,
  index: number,
): ChipAction[] {
  const count = lists[kind].length
  // main <-> situational is a real move; blind is a second opinion about the same champion (§6)
  const otherSection = OTHER_SECTION[kind]

  const actions: ChipAction[] = [
    {
      key: 'up',
      label: 'Move up',
      disabled: index <= 0,
      apply: () => moveWithin(lists, kind, index, index - 1),
    },
    {
      key: 'down',
      label: 'Move down',
      disabled: index >= count - 1,
      apply: () => moveWithin(lists, kind, index, index + 1),
    },
  ]

  if (otherSection) {
    actions.push({
      key: 'to-other-section',
      label: `Move to ${POOL_KIND_LABELS[otherSection]}`,
      disabled: false,
      apply: () => moveAcross(lists, kind, championId, otherSection),
    })
  }

  if (kind !== 'blind' && !lists.blind.includes(championId)) {
    actions.push({
      key: 'to-blind',
      label: 'Also blind-pickable',
      disabled: false,
      apply: () => moveAcross(lists, kind, championId, 'blind'),
    })
  }

  actions.push({
    key: 'remove',
    label: 'Remove',
    disabled: false,
    danger: true,
    apply: () => removeChampion(lists, kind, championId),
  })

  return actions
}
