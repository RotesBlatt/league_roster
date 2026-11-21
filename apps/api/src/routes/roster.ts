import { and, eq, inArray } from 'drizzle-orm'
import { Elysia } from 'elysia'
import type { Db } from '../db/index.ts'
import { profile, riotAccounts, rosterEntries, user } from '../db/schema.ts'
import { composeRoster } from '../lib/roster.ts'
import type { TeamScope } from '../lib/team-db.ts'
import type { AuthPlugin } from '../plugins/auth.ts'

/**
 * A team's roster, **read as a join** (player-profiles.md §2): `roster_entry` (captain-owned)
 * joined with `profile`, the main `riot_account` and, for members who have not filled a profile in
 * yet, the `user` row for a name.
 *
 * Four reads instead of one SQL join, deliberately: the tenant handle can only join one table, and
 * the composition rules are unit-tested in `lib/roster.ts`. The alternative — a handwritten join
 * with the role fallback and the main-account filter inside it — would be a rule living in SQL,
 * where this codebase cannot test it.
 *
 * The team predicate still comes from the scope: `rosterEntries` is only ever read through
 * `forTeam(team)`.
 */
export function createRosterRoutes(db: Db, scope: TeamScope, authPlugin: AuthPlugin) {
  return new Elysia({ prefix: '/roster' }).use(authPlugin).get(
    '/',
    async ({ team }) => {
      const entries = await scope(team).selectFrom(rosterEntries)
      if (entries.length === 0) return []

      // profile, accounts and user are global tables: no team predicate applies, and the ids
      // all came from rows the scope already proved belong to this team
      const userIds = entries.map((entry) => entry.userId)
      const [profiles, accounts, users] = await Promise.all([
        db
          .select({
            userId: profile.userId,
            displayName: profile.displayName,
            preferredRole: profile.preferredRole,
          })
          .from(profile)
          .where(inArray(profile.userId, userIds)),
        db
          .select({
            userId: riotAccounts.userId,
            gameName: riotAccounts.gameName,
            tagLine: riotAccounts.tagLine,
            isMain: riotAccounts.isMain,
            verifiedAt: riotAccounts.verifiedAt,
          })
          .from(riotAccounts)
          .where(and(inArray(riotAccounts.userId, userIds), eq(riotAccounts.isMain, true))),
        db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds)),
      ])

      return composeRoster({ entries, profiles, accounts, users })
    },
    { teamMember: true },
  )
}

export type RosterRoutes = ReturnType<typeof createRosterRoutes>
