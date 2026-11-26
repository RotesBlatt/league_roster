import { POOL_KINDS, type PoolKind } from '@lol/shared'

/**
 * The bands of one pool card, grouped by what they mean (champion-pools.md §7, amended 2026-11-26).
 *
 * `main`, `situational` and `blind` are what a player **can play**; `wip` is what they **want to
 * learn**. The page says so with a rule between the two groups — and the rule is decided here, as
 * data, because a divider written by hand between two JSX blocks is a layout decision that no test
 * can see and that drifts the moment a fifth kind appears.
 */

/** The list drawn apart: a plan, not something we can draft with today. */
export const DIVIDED_KIND: PoolKind = 'wip'

export type PoolBandGroup = {
  /** In model order (`POOL_KINDS`), so the bands read the same as the API returns them. */
  kinds: PoolKind[]
  /** The page draws a divider **above** the group. False for the first group: a rule with nothing above it is a border. */
  dividedFromAbove: boolean
}

/**
 * Groups in drawing order. Takes the kinds as an argument only so a test can ask "what if there were
 * three" without mutating a module constant; the page always calls it with no argument.
 */
export function poolBandGroups(kinds: readonly PoolKind[] = POOL_KINDS): PoolBandGroup[] {
  const groups: PoolBandGroup[] = []

  const draftable = kinds.filter((kind) => kind !== DIVIDED_KIND)
  if (draftable.length > 0) groups.push({ kinds: draftable, dividedFromAbove: false })

  const divided = kinds.filter((kind) => kind === DIVIDED_KIND)
  // `groups.length > 0`: if the divided kind ever came first, it would get no rule above it
  if (divided.length > 0) groups.push({ kinds: divided, dividedFromAbove: groups.length > 0 })

  return groups
}
