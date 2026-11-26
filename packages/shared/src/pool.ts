/**
 * Champion pools — the vocabulary and the rules (champion-pools.md §5, §6, §8).
 *
 * A pool is four ordered lists of champion ids that belong to one person: what they want to play
 * (`main`), what fits specific games (`situational`), what they are willing to first-pick (`blind`),
 * and what they want to learn (`wip`). No DB, no React, no HTTP: every rule here takes plain arrays
 * and returns plain values, so the parts that can be wrong quietly are testable without
 * infrastructure.
 *
 * Champion ids are opaque integers — never validated against the dump (§10.8). A champion that
 * patches away must not delete somebody's intent.
 */

/**
 * In drawing order: the three lists a player *has* come first, and `wip` last because the page draws
 * it behind a divider — it is a plan, not a pool you can draft with.
 */
export const POOL_KINDS = ['main', 'situational', 'blind', 'wip'] as const
export type PoolKind = (typeof POOL_KINDS)[number]

/**
 * One pool, four lists, in **priority order** (index 0 is the first answer). Shared by the API's
 * read model, the write payload and the page, so they cannot disagree about the shape.
 */
export type PoolLists = Record<PoolKind, number[]>

/** Hard sanity bound per list, not a target (§10.1). A 40-champion "pool" is a list, not a pool. */
export const POOL_CAP = 15

export const POOL_KIND_LABELS: Record<PoolKind, string> = {
  main: 'Main',
  situational: 'Situational',
  blind: 'Blind-pickable',
  wip: 'Learning',
}

/** A pool nobody has written yet: four empty lists, never a missing key. */
export function emptyPoolLists(): PoolLists {
  return { main: [], situational: [], blind: [], wip: [] }
}

/**
 * Who may write this pool (§8). Owner only — the captain included in "not the owner", because a
 * captain who "fixes" a teammate's pool has changed a statement of intent.
 *
 * `role` is part of the signature on purpose: it documents that nothing in here reads it.
 */
export function canEditPool(
  me: { id: string; role: 'captain' | 'member' } | null,
  ownerId: string,
): boolean {
  return me !== null && me.id === ownerId
}

/**
 * The list after moving one entry, without mutating the input.
 *
 * Out-of-range and fractional indices are a no-op rather than a truncation: this runs on every
 * keyboard move, and a bug here would silently drop a champion instead of doing nothing.
 */
export function moveEntry<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  if (!Number.isInteger(from) || !Number.isInteger(to)) return next
  if (from < 0 || to < 0 || from >= next.length || to >= next.length || from === to) return next

  const [moved] = next.splice(from, 1)
  if (moved === undefined) return next
  next.splice(to, 0, moved)
  return next
}

export type PoolProblem = { field: string; message: string }

const isChampionId = (value: number): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value > 0

/**
 * Everything wrong with a write, in one pass. An empty array means "store it".
 *
 * A bad entry fails the whole write instead of being dropped — a partially saved pool is worse than
 * a rejected one, because the owner cannot tell which of their edits survived (§5).
 *
 * Deliberately **not** checked: whether the dump knows the champion id (§10.8), and whether the
 * champion fits the player's role (§10.7). Both are hints, never gates.
 */
export function validatePoolWrite(lists: PoolLists): PoolProblem[] {
  const problems: PoolProblem[] = []

  for (const kind of POOL_KINDS) {
    const list = lists[kind]

    if (list.length > POOL_CAP) {
      problems.push({
        field: kind,
        message: `A ${kind} list holds at most ${POOL_CAP} champions`,
      })
    }

    const seen = new Set<number>()
    for (const championId of list) {
      if (!isChampionId(championId)) {
        problems.push({ field: kind, message: `${championId} is not a champion id` })
        break
      }
      if (seen.has(championId)) {
        problems.push({ field: kind, message: `Champion ${championId} is in ${kind} twice` })
        break
      }
      seen.add(championId)
    }
  }

  // One champion belongs to one pool: main and situational are mutually exclusive (§6). `blind` and
  // `wip` are the two lists that may freely overlap everything — blind is a second opinion about a
  // champion, and learning a champion you already play is a normal state, not a mistake.
  const inMain = new Set(lists.main.filter(isChampionId))
  const overlap = lists.situational.find((championId) => inMain.has(championId))
  if (overlap !== undefined) {
    problems.push({
      field: 'situational',
      message: `Champion ${overlap} is already in the main pool`,
    })
  }

  return problems
}
