import { and, count, desc, eq } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import type { Db } from '../db/index.ts'
import { memberships, players, user } from '../db/schema.ts'
import type { MemberDto } from '../db/schema.types.ts'
import { memberStatusSchema, teamParams, userRoleSchema } from '../lib/validate.ts'
import type { AuthPlugin } from '../plugins/auth.ts'

type MemberPatch = { role?: 'captain' | 'member'; status?: 'active' | 'disabled' }

/** Mounted under /api/teams/:slug. */
export function createMemberRoutes(db: Db, authPlugin: AuthPlugin) {
  return (
    new Elysia({ prefix: '/members' })
      .use(authPlugin)
      /**
       * This team's members, and only them. An account with no membership is not a
       * member of anything: it joins by opening this team's invite link, which creates
       * the membership. Nothing here can add a stranger.
       */
      .get(
        '/',
        async ({ team }) => {
          const rows = await db
            .select({
              id: user.id,
              name: user.name,
              email: user.email,
              image: user.image,
              createdAt: user.createdAt,
              playerId: players.id,
              teamId: memberships.teamId,
              role: memberships.role,
              status: memberships.status,
            })
            .from(user)
            // inner join: no membership in *this* team, no row
            .innerJoin(
              memberships,
              and(eq(memberships.userId, user.id), eq(memberships.teamId, team.id)),
            )
            .leftJoin(players, and(eq(players.userId, user.id), eq(players.teamId, team.id)))
            .orderBy(desc(user.createdAt))

          return rows.map<MemberDto>((row) => ({
            id: row.id,
            name: row.name,
            email: row.email,
            image: row.image,
            teamId: row.teamId,
            role: row.role,
            status: row.status,
            createdAt: row.createdAt.getTime(),
            hasPlayer: Boolean(row.playerId),
          }))
        },
        { teamCaptain: true },
      )
      .patch(
        '/:id',
        async ({ body, params: { id }, team, status, me }) => {
          // Only an existing member of this team can be changed. A stranger, a member of
          // another team and a deleted account are all the same 404 (§5).
          const [target] = await db
            .select({
              id: user.id,
              role: memberships.role,
              status: memberships.status,
            })
            .from(user)
            .innerJoin(
              memberships,
              and(eq(memberships.userId, user.id), eq(memberships.teamId, team.id)),
            )
            .where(eq(user.id, id))
            .limit(1)
          if (!target) return status(404, { message: 'Member not found' })

          // self-check first: it is the more useful message for the acting captain
          if (target.id === me.id && body.status === 'disabled') {
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
            const [row] = await db
              .select({ value: count() })
              .from(memberships)
              .where(
                and(
                  // the *team* must keep one active captain, not this particular user
                  eq(memberships.teamId, team.id),
                  eq(memberships.role, 'captain'),
                  eq(memberships.status, 'active'),
                ),
              )
            if ((row?.value ?? 0) <= 1) {
              return status(409, { message: 'There has to be at least one active captain' })
            }
          }

          const [updated] = await db
            .update(memberships)
            .set({ ...changes, updatedAt: new Date() })
            .where(and(eq(memberships.teamId, team.id), eq(memberships.userId, id)))
            .returning({ id: memberships.id })

          if (!updated) return status(500, { message: 'Update failed' })
          return { ok: true }
        },
        {
          teamCaptain: true,
          params: teamParams,
          // t.Partial keeps the literal types; t.Optional(UnionEnum(...)) collapses them to undefined.
          body: t.Partial(t.Object({ role: userRoleSchema, status: memberStatusSchema })),
        },
      )
  )
}
