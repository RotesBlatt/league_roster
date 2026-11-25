import { POOL_KINDS, validatePoolWrite } from '@lol/shared'
import { eq, inArray, sql } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import type { Db } from '../db/index.ts'
import { memberships, poolEntries, pools, profile, rosterEntries, user } from '../db/schema.ts'
import type { PoolsDto } from '../db/schema.types.ts'
import { composePools, type PoolRosterPerson } from '../lib/pools.ts'
import { compareRosterOrder } from '../lib/roster.ts'
import type { TeamScope } from '../lib/team-db.ts'
import type { AuthPlugin } from '../plugins/auth.ts'

/**
 * The team's champion pools, read (champion-pools.md §7, §8).
 *
 * `GET` is the whole feature's read half: one column per person, in role order, each with their
 * three ordered lists. It is a `member` right — seeing your teammates' opinions is the point — and
 * the write (`PUT /api/pools`, owner-only) is a separate route.
 *
 * Who is shown is **the roster, plus any member who already has a pool** (§7): somebody who saved a
 * pool before the captain put them on the roster appears at the position their preferred role
 * implies, which is where they will be once added — a pool that exists but is invisible is the
 * worst of both. `pool` / `pool_entry` are global tables keyed by the person, so they are read
 * through the plain `Db`, restricted to this team's member ids.
 *
 * Four small reads instead of one join, because the composition rules are unit-tested in
 * `lib/pools.ts` and would otherwise live in SQL where they cannot be.
 */
export function createPoolRoutes(db: Db, scope: TeamScope, authPlugin: AuthPlugin) {
  return new Elysia({ prefix: '/pools' }).use(authPlugin).get(
    '/',
    async ({ team }): Promise<PoolsDto> => {
      const [entries, memberRows] = await Promise.all([
        scope(team).selectFrom(rosterEntries),
        scope(team).selectFrom(memberships),
      ])

      // read for **members**, not for roster entries: a pool can exist before its row does
      const userIds = memberRows.map((row) => row.userId)
      if (userIds.length === 0) return { people: [] }
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

      const rostered = new Set(entries.map((entry) => entry.userId))
      const hasPool = new Set(headers.map((header) => header.ownerId))

      const person = (
        userId: string,
        own: (typeof profiles)[number] | undefined,
        role: PoolRosterPerson['role'],
        isActive: boolean,
      ): PoolRosterPerson => ({
        userId,
        // same fallback as the roster page: a member without a profile is a person, not a gap
        displayName: own?.displayName ?? nameOf.get(userId) ?? 'Unknown',
        role,
        isActive,
      })

      const roster: PoolRosterPerson[] = [
        // the roster, with the captain's role override winning over the player's preference
        ...entries.map((entry) => {
          const own = profileOf.get(entry.userId)
          return person(
            entry.userId,
            own,
            entry.roleOverride ?? own?.preferredRole ?? null,
            entry.isActive,
          )
        }),
        // …plus members who already have a pool but no roster row: they take their own role, so
        // their column sits where it will be once the captain adds them
        ...memberRows
          .filter((row) => !rostered.has(row.userId) && hasPool.has(row.userId))
          .map((row) => {
            const own = profileOf.get(row.userId)
            return person(row.userId, own, own?.preferredRole ?? null, row.status === 'active')
          }),
      ].sort((a, b) => compareRosterOrder(a, b) || a.userId.localeCompare(b.userId))

      return { people: composePools({ roster, pools: headers, entries: rows }) }
    },
    { teamMember: true },
  )
}

export type PoolRoutes = ReturnType<typeof createPoolRoutes>

/** The whole pool, every write: a partial list would invent intermediate states (§5). */
const writeBody = t.Object({
  /** Optimistic concurrency: the version the client last read. `0` = never saved. */
  version: t.Integer({ minimum: 0 }),
  lists: t.Object({
    main: t.Array(t.Integer()),
    situational: t.Array(t.Integer()),
    blind: t.Array(t.Integer()),
  }),
})

/**
 * `PUT /api/pools` — write **your own** pool. Global, not team-scoped, like the profile: the pool
 * belongs to a person, and a player in two teams has one pool (§3).
 *
 * **The address is the guard.** There is deliberately no variant that names another owner, so
 * "nobody may write someone else's pool" (§8) is structural rather than a check that can be
 * forgotten. The shared `canEditPool` is the same rule expressed for the page, which has to decide
 * *which column* grows handles without asking the server.
 *
 * The version check and the bump are one atomic upsert: a stale tab gets `409` from the database's
 * own answer instead of racing a read-then-write. Nothing is deleted until the header has moved, so
 * a rejected write leaves the stored pool exactly as it was.
 */
export function createMyPoolRoutes(db: Db, authPlugin: AuthPlugin) {
  return new Elysia().use(authPlugin).put(
    '/pools',
    async ({ body, me, status }) => {
      // the rules live in `@lol/shared` so the page and the API cannot disagree about the cap,
      // the duplicates, or main↔situational
      const problems = validatePoolWrite(body.lists)
      if (problems.length > 0) {
        return status(422, {
          message: 'Invalid pool',
          details: problems.map((problem) => ({
            path: problem.field,
            message: problem.message,
          })),
        })
      }

      const now = new Date()
      const rows = POOL_KINDS.flatMap((kind) =>
        body.lists[kind].map((championId, position) => ({
          id: crypto.randomUUID(),
          ownerId: me.id,
          kind,
          championId,
          position,
          createdAt: now,
          updatedAt: now,
        })),
      )

      return db.transaction(async (tx) => {
        const [header] = await tx
          .insert(pools)
          .values({ ownerId: me.id, version: 1, updatedAt: now })
          .onConflictDoUpdate({
            target: pools.ownerId,
            set: { version: sql`${pools.version} + 1`, updatedAt: now },
            // the optimistic check, in the same statement: mismatched version -> no row returned
            setWhere: eq(pools.version, body.version),
          })
          .returning({ version: pools.version })

        if (!header) {
          const [current] = await tx
            .select({ version: pools.version })
            .from(pools)
            .where(eq(pools.ownerId, me.id))
            .limit(1)

          return status(409, { reason: 'stale' as const, version: current?.version ?? 0 })
        }

        // delete-then-insert: one statement per table, so no intermediate position can collide
        await tx.delete(poolEntries).where(eq(poolEntries.ownerId, me.id))
        if (rows.length > 0) await tx.insert(poolEntries).values(rows)

        return { version: header.version }
      })
    },
    { auth: true, body: writeBody },
  )
}

export type MyPoolRoutes = ReturnType<typeof createMyPoolRoutes>
