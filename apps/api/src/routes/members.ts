import { and, desc, eq } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import { memberships, players, user } from '../db/schema.ts'
import type { MemberDto } from '../db/schema.types.ts'
import type { Logger } from '../lib/log/logger.ts'
import { noopLogger } from '../lib/log/noop.ts'
import type { TeamScope } from '../lib/team-db.ts'
import { memberStatusSchema, teamParams, userRoleSchema } from '../lib/validate.ts'
import type { AuthPlugin } from '../plugins/auth.ts'

type MemberPatch = { role?: 'captain' | 'member'; status?: 'active' | 'disabled' }

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

        // `hasPlayer` used to be a second left join; from here it is one scoped read of the
        // roster, which is a handful of rows and keeps the join helper to one join
        const roster = await teamDb.selectFrom(players)
        const linked = new Set(roster.map((row) => row.userId).filter((id) => id !== null))

        return rows.map<MemberDto>((row) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          image: row.image,
          teamId: row.teamId,
          role: row.role,
          status: row.status,
          createdAt: row.createdAt.getTime(),
          hasPlayer: linked.has(row.id),
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
        const [target] = await teamDb.selectFrom(memberships, eq(memberships.userId, id))
        if (!target) {
          reject('not_found')
          return status(404, { message: 'Member not found' })
        }

        // self-check first: it is the more useful message for the acting captain
        if (target.userId === me.id && body.status === 'disabled') {
          reject('self_disable')
          return status(409, { message: 'You cannot disable your own account' })
        }

        const changes: MemberPatch = {
          ...(body.role !== undefined && { role: body.role }),
          ...(body.status !== undefined && { status: body.status }),
        }
        if (Object.keys(changes).length === 0) return { ok: true }

        const demotingCaptain =
          target.role === 'captain' && (body.role === 'member' || body.status === 'disabled')
        if (demotingCaptain) {
          // the *team* must keep one active captain, not this particular user
          const activeCaptains = await teamDb.selectFrom(
            memberships,
            and(eq(memberships.role, 'captain'), eq(memberships.status, 'active')),
          )
          if (activeCaptains.length <= 1) {
            reject('last_captain')
            return status(409, { message: 'There has to be at least one active captain' })
          }
        }

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
