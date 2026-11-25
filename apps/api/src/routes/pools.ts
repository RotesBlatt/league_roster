import { inArray } from 'drizzle-orm'
import { Elysia } from 'elysia'
import type { Db } from '../db/index.ts'
import { poolEntries, pools, profile, rosterEntries, user } from '../db/schema.ts'
import type { PoolsDto } from '../db/schema.types.ts'
import { composePools, type PoolRosterPerson } from '../lib/pools.ts'
import { compareRosterOrder } from '../lib/roster.ts'
import type { TeamScope } from '../lib/team-db.ts'
import type { AuthPlugin } from '../plugins/auth.ts'

/**
 * The team's champion pools, read (champion-pools.md §7, §8).
 *
 * `GET` is the whole feature's read half: every roster entry, in roster order, each with their
 * three ordered lists. It is a `member` right — seeing your teammates' opinions is the point — and
 * the write (`PUT /api/pools`, owner-only) lands in the next slice.
 *
 * The roster is the source of *who* is shown (roster entries, so substitutes are included and a
 * member without a roster row does not appear); `pool` / `pool_entry` are global tables keyed by the
 * person, so they are read through the plain `Db` — the ids all came from entries the scope already
 * proved belong to this team.
 *
 * Four small reads instead of one join, because the composition rules are unit-tested in
 * `lib/pools.ts` and would otherwise live in SQL where they cannot be.
 */
export function createPoolRoutes(db: Db, scope: TeamScope, authPlugin: AuthPlugin) {
  return new Elysia({ prefix: '/pools' }).use(authPlugin).get(
    '/',
    async ({ team }): Promise<PoolsDto> => {
      const entries = await scope(team).selectFrom(rosterEntries)
      if (entries.length === 0) return { people: [] }

      const userIds = entries.map((entry) => entry.userId)
      const [profiles, users, headers, rows] = await Promise.all([
        db
          .select({
            userId: profile.userId,
            displayName: profile.displayName,
            preferredRole: profile.preferredRole,
          })
          .from(profile)
          .where(inArray(profile.userId, userIds)),
        db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds)),
        db.select().from(pools).where(inArray(pools.ownerId, userIds)),
        db.select().from(poolEntries).where(inArray(poolEntries.ownerId, userIds)),
      ])

      const profileOf = new Map(profiles.map((row) => [row.userId, row]))
      const nameOf = new Map(users.map((row) => [row.id, row.name]))

      const roster: PoolRosterPerson[] = entries
        .map((entry) => {
          const own = profileOf.get(entry.userId)
          return {
            userId: entry.userId,
            // same fallback as the roster page: a member without a profile is a person, not a gap
            displayName: own?.displayName ?? nameOf.get(entry.userId) ?? 'Unknown',
            // the captain's override wins over the player's stated preference
            role: entry.roleOverride ?? own?.preferredRole ?? null,
            isActive: entry.isActive,
          }
        })
        .sort((a, b) => compareRosterOrder(a, b) || a.userId.localeCompare(b.userId))

      return { people: composePools({ roster, pools: headers, entries: rows }) }
    },
    { teamMember: true },
  )
}

export type PoolRoutes = ReturnType<typeof createPoolRoutes>
