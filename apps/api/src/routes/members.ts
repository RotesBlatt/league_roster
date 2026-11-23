import { and, desc, eq, inArray } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import type { Db } from '../db/index.ts'
import { memberships, riotAccounts, rosterEntries, user } from '../db/schema.ts'
import type { MemberDto } from '../db/schema.types.ts'
import type { Logger } from '../lib/log/logger.ts'
import { noopLogger } from '../lib/log/noop.ts'
import { decideMemberChange } from '../lib/member-change.ts'
import type { TeamScope } from '../lib/team-db.ts'
import { memberStatusSchema, teamParams, userRoleSchema } from '../lib/validate.ts'
import type { AuthPlugin } from '../plugins/auth.ts'

/** The joined row this route maps: membership fields plus the identity they belong to. */
type MemberRow = {
  id: string
  name: string
  email: string
  image: string | null
  createdAt: Date
  teamId: string
  role: MemberDto['role']
  status: MemberDto['status']
}

/**
 * Mounted under /api/teams/:slug, scoped like the rest: every query starts from `membership`,
 * which carries the `teamId`, so "this team's members" is the only thing the handle can express.
 *
 * This team's members, and only them. An account with no membership is not a member of
 * anything: it joins by opening this team's invite link, which creates the membership.
 * Nothing here can add a stranger.
 */
export function createMemberRoutes(
  db: Db,
  scope: TeamScope,
  authPlugin: AuthPlugin,
  requestLogger?: (request: Request) => Logger,
) {
  return new Elysia({ prefix: '/members' })
    .use(authPlugin)
    .get(
      '/',
      async ({ team }) => {
        const teamDb = scope(team)
        // inner join: no membership in *this* team, no row
        const rows: MemberRow[] = await teamDb.joinFrom(
          memberships,
          user,
          eq(memberships.userId, user.id),
          {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
            createdAt: user.createdAt,
            teamId: memberships.teamId,
            role: memberships.role,
            status: memberships.status,
          },
          { kind: 'inner', orderBy: [desc(user.createdAt)] },
        )

        // `hasRosterEntry` is a scoped read of roster_entry, not a second join: a handful of rows,
        // and the join helper stays at one join. userId is NOT NULL there, so no filtering.
        const roster = await teamDb.selectFrom(rosterEntries)
        const linked = new Set(roster.map((row) => row.userId))

        // his accounts, main first: the captain needs them to pick the one this team uses
        const ids = rows.map((row) => row.id)
        const accountRows = ids.length
          ? await db
              .select({
                id: riotAccounts.id,
                userId: riotAccounts.userId,
                gameName: riotAccounts.gameName,
                tagLine: riotAccounts.tagLine,
                isMain: riotAccounts.isMain,
              })
              .from(riotAccounts)
              .where(inArray(riotAccounts.userId, ids))
          : []

        const accountsByUser = new Map<string, MemberDto['accounts']>()
        for (const account of accountRows) {
          const list = accountsByUser.get(account.userId) ?? []
          list.push({
            id: account.id,
            gameName: account.gameName,
            tagLine: account.tagLine,
            isMain: account.isMain,
          })
          accountsByUser.set(account.userId, list)
        }
        for (const list of accountsByUser.values()) {
          list.sort(
            (a, b) => Number(b.isMain) - Number(a.isMain) || a.gameName.localeCompare(b.gameName),
          )
        }

        return rows.map<MemberDto>((row) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          image: row.image,
          teamId: row.teamId,
          role: row.role,
          status: row.status,
          createdAt: row.createdAt.getTime(),
          hasRosterEntry: linked.has(row.id),
          accounts: accountsByUser.get(row.id) ?? [],
        }))
      },
      { teamCaptain: true },
    )
    .patch(
      '/:id',
      async ({ body, params: { id }, team, status, me, request }) => {
        const teamDb = scope(team)
        const log = requestLogger?.(request) ?? noopLogger
        const reject = (reason: string) =>
          log.warn('member.change_rejected', { targetUserId: id, byUserId: me.id, reason })

        // Only an existing member of this team can be changed. A stranger, a member of
        // another team and a deleted account are all the same 404 (§5) — and the scoped
        // lookup is what makes the other team's member invisible rather than merely refused.
        //
        // The *rules* are not here: `decideMemberChange` owns them, and these two reads supply the
        // facts it decides on (a count is a fact about the team, not a decision).
        const [target] = await teamDb.selectFrom(memberships, eq(memberships.userId, id))
        if (!target) {
          reject('not_found')
          return status(404, { message: 'Member not found' })
        }

        // the *team* must keep one active captain, not this particular user
        const activeCaptains = await teamDb.selectFrom(
          memberships,
          and(eq(memberships.role, 'captain'), eq(memberships.status, 'active')),
        )

        const decision = decideMemberChange({
          actorId: me.id,
          target,
          body,
          activeCaptainCount: activeCaptains.length,
        })
        if (!decision.ok) {
          reject(decision.reason)
          return status(decision.status, { message: decision.message })
        }

        const changes = decision.changes
        if (Object.keys(changes).length === 0) return { ok: true }

        const [updated] = await teamDb.update(
          memberships,
          { ...changes, updatedAt: new Date() },
          eq(memberships.userId, id),
        )

        if (!updated) {
          reject('update_failed')
          return status(500, { message: 'Update failed' })
        }

        log.info('member.updated', {
          targetUserId: id,
          byUserId: me.id,
          ...(body.role !== undefined && { role: body.role }),
          ...(body.status !== undefined && { status: body.status }),
        })
        return { ok: true }
      },
      {
        teamCaptain: true,
        params: teamParams,
        // t.Partial keeps the literal types; t.Optional(UnionEnum(...)) collapses them to undefined.
        body: t.Partial(t.Object({ role: userRoleSchema, status: memberStatusSchema })),
      },
    )
}
