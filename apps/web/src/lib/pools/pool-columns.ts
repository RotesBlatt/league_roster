import type { PoolPersonDto } from '@lol/api/schema-types'
import { ROLES, type Role } from '@lol/shared'

/**
 * Which columns the pool page draws (champion-pools.md §7).
 *
 * The page always has the same five role slots, **TOP → SUP**, whether or not anybody fills them: an
 * empty column with a role heading says "we have nobody here", while a missing column silently
 * changes the shape of the page and makes people hunt for the role that is gone. A pool is a
 * conversation about five positions; the page should look like five positions.
 *
 * Extra people (a second mid, a substitute) get their own column next to their role, and people with
 * no role at all come last — they have no position to sit at. The order *inside* a role is the order
 * given (the server already sorted by name), so this function never re-sorts people.
 */
export type PoolColumnSlot = {
  role: Role | null
  /** `null` means "this role has nobody" — the page draws an empty column for it. */
  person: PoolPersonDto | null
}

export function poolColumns(people: readonly PoolPersonDto[]): PoolColumnSlot[] {
  const byRole = new Map<Role | null, PoolPersonDto[]>()

  for (const person of people) {
    const own = byRole.get(person.role) ?? []
    own.push(person)
    byRole.set(person.role, own)
  }

  const slots: PoolColumnSlot[] = []

  for (const role of ROLES) {
    const filled = byRole.get(role) ?? []
    // one slot per person on that role, or exactly one empty slot if there is nobody
    if (filled.length === 0) slots.push({ role, person: null })
    else for (const person of filled) slots.push({ role, person })
  }

  for (const person of byRole.get(null) ?? []) slots.push({ role: null, person })

  return slots
}
