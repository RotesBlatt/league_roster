import { moveEntry, POOL_CAP, type PoolKind, type PoolLists } from '@lol/shared'

/**
 * The local editing rules of the pool page (champion-pools.md §6, §7).
 *
 * The API validates the same invariants (`validatePoolWrite`), but a page that only learns about
 * "main and situational are exclusive" from a 422 has already shown the user a lie. So the rules
 * live here too, as plain functions: what "add" means, what a cross-kind move does, and what the
 * cap does — and then the page sends one whole pool and lets the server be the authority.
 *
 * Every function returns a new `PoolLists`; nothing mutates what it is given.
 */

/**
 * The two pool sections are exclusive; `blind` is a separate opinion and `wip` a separate plan, and
 * both may overlap them (and each other).
 */
const isPoolSection = (kind: PoolKind): boolean => kind === 'main' || kind === 'situational'

const copy = (lists: PoolLists): PoolLists => ({
  main: [...lists.main],
  situational: [...lists.situational],
  blind: [...lists.blind],
  wip: [...lists.wip],
})

/**
 * Appends a champion to `kind` — at the end, because the order *is* the priority.
 *
 * Adding to `main` or `situational` removes the champion from the other section (a champion is in
 * one pool). `blind` and `wip` overlap freely, in both directions: a blind-pickable or learning
 * champion stays in its pool section, and a pool champion may be added to either.
 */
export function addChampion(lists: PoolLists, kind: PoolKind, championId: number): PoolLists {
  const next = copy(lists)

  if (next[kind].includes(championId)) return next
  // the cap is the shared one; a full list is left as it is rather than silently dropping a champion
  if (next[kind].length >= POOL_CAP) return next

  if (isPoolSection(kind)) {
    const other: PoolKind = kind === 'main' ? 'situational' : 'main'
    next[other] = next[other].filter((id) => id !== championId)
  }

  next[kind] = [...next[kind], championId]
  return next
}

/** Takes a champion out of one list, and only that list. */
export function removeChampion(lists: PoolLists, kind: PoolKind, championId: number): PoolLists {
  const next = copy(lists)
  next[kind] = next[kind].filter((id) => id !== championId)
  return next
}

/**
 * Moves one entry inside its list. Delegates to the shared `moveEntry` so the page and any future
 * caller cannot disagree about out-of-range behaviour (a no-op, never a truncation).
 */
export function moveWithin(lists: PoolLists, kind: PoolKind, from: number, to: number): PoolLists {
  const next = copy(lists)
  next[kind] = moveEntry(next[kind], from, to)
  return next
}

/**
 * The cross-kind gesture: "move to …" from one list to another.
 *
 * The two directions are deliberately not symmetric (§6):
 * - **into a pool section** is a relocation — the champion leaves the list it came from, and
 *   `addChampion` clears the other pool section too, so it ends up in exactly one;
 * - **into `blind` or `wip`** is an *addition*, not a move: blind is a second opinion and wip is a
 *   plan, so a main-pool champion stays in the main pool and becomes blind-pickable or learner too.
 *   Leaving `wip` for a pool section is therefore the only direction that removes it.
 */
export function moveAcross(
  lists: PoolLists,
  from: PoolKind,
  championId: number,
  to: PoolKind,
): PoolLists {
  if (from === to) return copy(lists)
  if (!isPoolSection(to)) return addChampion(lists, to, championId)
  return addChampion(removeChampion(lists, from, championId), to, championId)
}

/**
 * `moveAcross`, but landing at `index` instead of at the end — what a drop **on a chip** means.
 *
 * Same asymmetry as the menu (§6): entering a pool section relocates the champion, entering `blind`
 * adds a second opinion and leaves the pool section alone. An out-of-range index puts it last rather
 * than dropping the champion (`moveWithin` is a no-op out of range, so the append survives).
 */
export function moveAcrossAt(
  lists: PoolLists,
  from: PoolKind,
  championId: number,
  to: PoolKind,
  index: number,
): PoolLists {
  if (from === to) return moveWithin(lists, to, lists[to].indexOf(championId), index)

  const moved = moveAcross(lists, from, championId, to)
  const landed = moved[to].indexOf(championId)
  return moveWithin(moved, to, landed, index)
}
