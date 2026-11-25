import type { PoolKind, PoolLists } from '@lol/shared'
import { moveAcrossAt } from './pool-edit.ts'

/**
 * The drag gesture's translation layer (champion-pools.md §7): a dropped DOM id in, the next pool
 * out. The moving rules themselves stay in `pool-edit.ts` — this only says what was dragged onto
 * what, which is the part a mouse test would never pin down properly.
 *
 * **The band is part of the identity.** A champion may be in `main` *and* in `blind` (§6), so an id
 * of "103" would let a drag of the blind copy move the pool copy. Every id therefore carries its
 * band, and a band is a drop target of its own so an empty band can receive a champion.
 */

const POOL_KIND_SET = new Set<string>(['main', 'situational', 'blind'])

const isPoolKind = (value: string | undefined): value is PoolKind =>
  value !== undefined && POOL_KIND_SET.has(value)

export function championDragId(kind: PoolKind, championId: number): string {
  return `chip:${kind}:${championId}`
}

export function bandDragId(kind: PoolKind): string {
  return `band:${kind}`
}

/** A drop target: a champion in a band, or the band itself (`championId: null`). */
export type DragTarget = { kind: PoolKind; championId: number | null }

/** Anything that is not one of ours is `null` — never a partial match, never a throw. */
export function parseDragId(id: string | number | null): DragTarget | null {
  if (id === null) return null

  const [type, kind, champion] = String(id).split(':')
  if (!isPoolKind(kind)) return null

  if (type === 'band') return champion === undefined ? { kind, championId: null } : null
  if (type !== 'chip' || champion === undefined || !/^\d+$/.test(champion)) return null

  return { kind, championId: Number(champion) }
}

const copy = (lists: PoolLists): PoolLists => ({
  main: [...lists.main],
  situational: [...lists.situational],
  blind: [...lists.blind],
})

/**
 * What `onDragEnd` should store.
 *
 * - dropped on **another champion**: land at that champion's position (not merely "in that band");
 * - dropped on a **band** (including an empty one): land at the end of it;
 * - dropped on itself, on nothing, or with an id that is not ours: unchanged, and the write is not
 *   attempted. A gesture that moved nothing must not bump the version.
 */
export function dragMove(
  lists: PoolLists,
  activeId: string | number | null,
  overId: string | number | null,
): PoolLists {
  const active = parseDragId(activeId)
  const over = parseDragId(overId)

  if (!active || active.championId === null || !over) return copy(lists)
  if (over.kind === active.kind && over.championId === active.championId) return copy(lists)

  const index =
    over.championId === null ? lists[over.kind].length : lists[over.kind].indexOf(over.championId)

  return moveAcrossAt(lists, active.kind, active.championId, over.kind, index)
}
