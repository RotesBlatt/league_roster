import { emptyPoolLists, POOL_KINDS, type Role } from '@lol/shared'
import type { PoolEntryRow, PoolRow } from '../db/schema.ts'
import type { PoolPersonDto } from '../db/schema.types.ts'

/**
 * The pool read model (champion-pools.md §7): the roster, each person with their three ordered
 * lists.
 *
 * The composition is a plain function so the quiet failures are unit-tested instead of discovered
 * on the page: a player who never saved must still be *present* (as `version: 0`, three empty
 * lists), the order inside a list must come from `position` rather than from the query's accident,
 * and somebody who left the roster must not surface because their rows still exist.
 *
 * The input roster is already in display order — the route sorts it with the same comparator the
 * roster page uses. This function never re-sorts people: "we do not know your role" must not
 * become "we moved you".
 */

/** The little the pool page needs to know about a person. */
export type PoolRosterPerson = {
  userId: string
  displayName: string
  role: Role | null
  isActive: boolean
}

export function composePools(input: {
  roster: readonly PoolRosterPerson[]
  pools: readonly PoolRow[]
  entries: readonly PoolEntryRow[]
}): PoolPersonDto[] {
  const headers = new Map(input.pools.map((row) => [row.ownerId, row]))

  // owner -> kind -> entries. Positions are dense, so sorting by position is the whole order.
  const byOwner = new Map<string, Map<string, { championId: number; position: number }[]>>()

  for (const entry of input.entries) {
    const kinds = byOwner.get(entry.ownerId) ?? new Map()
    const list = kinds.get(entry.kind) ?? []
    list.push({ championId: entry.championId, position: entry.position })
    kinds.set(entry.kind, list)
    byOwner.set(entry.ownerId, kinds)
  }

  return input.roster.map((person): PoolPersonDto => {
    const header = headers.get(person.userId)
    const kinds = byOwner.get(person.userId)
    const lists = emptyPoolLists()

    for (const kind of POOL_KINDS) {
      const rows = kinds?.get(kind)
      if (!rows) continue
      // championId as the tiebreak only so a corrupt duplicate position is still deterministic
      lists[kind] = [...rows]
        .sort((a, b) => a.position - b.position || a.championId - b.championId)
        .map((row) => row.championId)
    }

    return {
      userId: person.userId,
      displayName: person.displayName,
      role: person.role,
      isActive: person.isActive,
      // no header row means "never saved", which is version 0 — not null, so a client can send it
      // straight back on the first write
      version: header?.version ?? 0,
      updatedAt: header?.updatedAt.getTime() ?? null,
      lists,
    }
  })
}
