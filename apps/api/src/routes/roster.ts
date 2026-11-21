import { and, eq, inArray } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import type { Db } from '../db/index.ts'
import { memberships, profile, riotAccounts, rosterEntries, user } from '../db/schema.ts'
import { uniqueViolation } from '../lib/pg-errors.ts'
import { composeRoster, normalizeRosterWrite } from '../lib/roster.ts'
import type { TeamScope } from '../lib/team-db.ts'
import { teamParams } from '../lib/validate.ts'
import type { AuthPlugin } from '../plugins/auth.ts'

/** Only the fields a captain owns. Name, position preference and Riot ID are the player's. */
const writeBody = t.Object({
  /** which of his accounts this team uses; null/absent = follow his main account */
  accountId: t.Optional(t.Union([t.String(), t.Null()])),
  note: t.Optional(t.Union([t.String(), t.Null()])),
  /** a role string sets the override, `null` clears it, absent leaves it alone */
  roleOverride: t.Optional(t.Union([t.String(), t.Null()])),
  isActive: t.Optional(t.Boolean()),
})

const addBody = t.Object({
  userId: t.String(),
  accountId: t.Optional(t.Union([t.String(), t.Null()])),
  note: t.Optional(t.Union([t.String(), t.Null()])),
  roleOverride: t.Optional(t.Union([t.String(), t.Null()])),
})

const ALREADY_ON_ROSTER = { message: 'That person is already on the roster' }
const NOT_FOUND = { message: 'Roster entry not found' }
const FOREIGN_ACCOUNT = { message: 'That account does not belong to this member' }

/** Marks "the requested id is not one of his accounts" without throwing. */
const INVALID_ACCOUNT = Symbol('invalid-account')

/**
 * The account an entry should point at: `null` means **follow his main account** (so changing the
 * main later changes the roster too), an explicit id must belong to that member.
 */
async function resolveAccountId(
  db: Db,
  userId: string,
  requested: string | null | undefined,
): Promise<string | null | typeof INVALID_ACCOUNT> {
  if (requested === undefined || requested === null) return null

  const [row] = await db
    .select({ id: riotAccounts.id })
    .from(riotAccounts)
    .where(and(eq(riotAccounts.id, requested), eq(riotAccounts.userId, userId)))
    .limit(1)

  return row ? row.id : INVALID_ACCOUNT
}

/** The unique index that keeps one entry per person per team. */
const TEAM_MEMBER_INDEX = 'roster_entry_teamId_userId_idx'

/**
 * A team's roster: **read as a join** (player-profiles.md §2), **written as captain-owned entries**.
 *
 * Read: `roster_entry` joined with `profile`, the main `riot_account` and, for members who have not
 * filled a profile in yet, the `user` row for a name. Four reads instead of one SQL join, because
 * the composition rules (`roleOverride ?? preferredRole`, "only the main account") are unit-tested
 * in `lib/roster.ts` and would otherwise live in SQL where they cannot be.
 *
 * Write: only `note`, `roleOverride` and `isActive`. A captain cannot rename a player or change
 * their Riot ID from here — that is the player's own page, and the split exists to make that
 * impossible rather than merely discouraged.
 */
export function createRosterRoutes(db: Db, scope: TeamScope, authPlugin: AuthPlugin) {
  const detail = (problems: { field: string; message: string }[]) =>
    problems.map((problem) => ({ path: problem.field, message: problem.message }))

  return new Elysia({ prefix: '/roster' })
    .use(authPlugin)
    .get(
      '/',
      async ({ team }) => {
        const entries = await scope(team).selectFrom(rosterEntries)
        if (entries.length === 0) return []

        // profile, accounts and user are global tables: no team predicate applies, and the ids all
        // came from rows the scope already proved belong to this team
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
              id: riotAccounts.id,
              userId: riotAccounts.userId,
              gameName: riotAccounts.gameName,
              tagLine: riotAccounts.tagLine,
              isMain: riotAccounts.isMain,
              verifiedAt: riotAccounts.verifiedAt,
              soloTier: riotAccounts.soloTier,
              soloDivision: riotAccounts.soloDivision,
              flexTier: riotAccounts.flexTier,
              flexDivision: riotAccounts.flexDivision,
            })
            .from(riotAccounts)
            // every account, not just the main one: the captain picks the account per team
            .where(inArray(riotAccounts.userId, userIds)),
          db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds)),
        ])

        return composeRoster({ entries, profiles, accounts, users })
      },
      { teamMember: true },
    )
    .post(
      '/',
      async ({ body, team, status }) => {
        const { values, problems } = normalizeRosterWrite({
          note: body.note,
          roleOverride: body.roleOverride,
        })
        if (problems.length > 0) {
          return status(422, { message: 'Invalid roster entry', details: detail(problems) })
        }

        // "on the roster" and "is a member" are the same fact; the foreign key would also refuse
        // this, but a constraint error is not a sentence a captain can act on
        const [membership] = await scope(team).selectFrom(
          memberships,
          eq(memberships.userId, body.userId),
        )
        if (!membership) {
          return status(422, { message: 'That person is not a member of this team' })
        }

        const accountId = await resolveAccountId(db, body.userId, values.accountId)
        if (accountId === INVALID_ACCOUNT) return status(422, FOREIGN_ACCOUNT)

        const now = new Date()
        try {
          // no teamId in the values: the scope injects it
          const row = await scope(team).insertInto(rosterEntries, {
            id: crypto.randomUUID(),
            userId: body.userId,
            accountId,
            note: values.note ?? null,
            roleOverride: values.roleOverride ?? null,
            isActive: true,
            createdAt: now,
            updatedAt: now,
          })

          if (!row) return status(500, { message: 'Could not add to the roster' })
          return { ok: true, id: row.id }
        } catch (error) {
          if (uniqueViolation(error) === TEAM_MEMBER_INDEX) return status(409, ALREADY_ON_ROSTER)
          throw error
        }
      },
      { teamCaptain: true, body: addBody },
    )
    .patch(
      '/:id',
      async ({ body, params: { id }, team, status }) => {
        const { values, problems } = normalizeRosterWrite(body)
        if (problems.length > 0) {
          return status(422, { message: 'Invalid roster entry', details: detail(problems) })
        }

        // his accounts, not anybody's: the entry names the member
        if (values.accountId !== undefined) {
          const [existing] = await scope(team).selectFrom(rosterEntries, eq(rosterEntries.id, id))
          if (!existing) return status(404, NOT_FOUND)

          const accountId = await resolveAccountId(db, existing.userId, values.accountId)
          if (accountId === INVALID_ACCOUNT) return status(422, FOREIGN_ACCOUNT)
          values.accountId = accountId
        }

        // an omitted field is not in `values`, so a note-only patch cannot wipe the override
        const updated = await scope(team).update(
          rosterEntries,
          { ...values, updatedAt: new Date() },
          eq(rosterEntries.id, id),
        )

        if (updated.length === 0) return status(404, NOT_FOUND)
        return { ok: true }
      },
      { teamCaptain: true, params: teamParams, body: writeBody },
    )
    .delete(
      '/:id',
      async ({ params: { id }, team, status }) => {
        // returning rows so "not found" and "deleted" stay distinguishable, and never another
        // team's entry
        const deleted = await scope(team).deleteFrom(rosterEntries, eq(rosterEntries.id, id))

        if (deleted.length === 0) return status(404, NOT_FOUND)
        return { ok: true }
      },
      { teamCaptain: true, params: teamParams },
    )
}

export type RosterRoutes = ReturnType<typeof createRosterRoutes>
