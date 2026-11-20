import { desc, eq } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import { invites, user } from '../db/schema.ts'
import type { InviteDto } from '../db/schema.types.ts'
import type { Logger } from '../lib/log/logger.ts'
import { noopLogger } from '../lib/log/noop.ts'
import type { TeamScope } from '../lib/team-db.ts'
import { inviteCode, teamParams } from '../lib/validate.ts'
import type { AuthPlugin } from '../plugins/auth.ts'

function toDto(row: typeof invites.$inferSelect, createdByName: string | null): InviteDto {
  return {
    id: row.id,
    code: row.code,
    note: row.note,
    maxUses: row.maxUses,
    uses: row.uses,
    expiresAt: row.expiresAt ? row.expiresAt.getTime() : null,
    revokedAt: row.revokedAt ? row.revokedAt.getTime() : null,
    createdAt: row.createdAt.getTime(),
    createdByName,
    path: `/join/${row.code}`,
  }
}

/**
 * Mounted under /api/teams/:slug. A code belongs to exactly one team, so claiming it
 * (see routes/claim.ts) can only ever join that team.
 *
 * Scoped like the roster: the `user` join is only there for a display name, and the team
 * predicate comes from the handle — which is what makes revoking another team's invite
 * impossible, rather than "possible but answered with a 404".
 */
export function createInviteRoutes(
  scope: TeamScope,
  authPlugin: AuthPlugin,
  requestLogger?: (request: Request) => Logger,
) {
  return new Elysia({ prefix: '/invites' })
    .use(authPlugin)
    .get(
      '/',
      async ({ team }) => {
        // the projection is opaque to the handle, so the row shape is stated here, where it is used
        const rows: { invite: typeof invites.$inferSelect; createdByName: string | null }[] =
          await scope(team).joinFrom(
            invites,
            user,
            eq(invites.createdBy, user.id),
            { invite: invites, createdByName: user.name },
            { orderBy: [desc(invites.createdAt)] },
          )
        return rows.map((row) => toDto(row.invite, row.createdByName))
      },
      { teamCaptain: true },
    )
    .post(
      '/',
      async ({ body, me, team, request }) => {
        // no teamId in the values: the scope injects it
        const row = await scope(team).insertInto(invites, {
          id: crypto.randomUUID(),
          code: inviteCode(),
          note: body.note ?? null,
          createdBy: me.id,
          maxUses: body.maxUses ?? 1,
          expiresAt: body.expiresInDays
            ? new Date(Date.now() + body.expiresInDays * 86_400_000)
            : null,
          createdAt: new Date(),
        })

        if (!row) throw new Error('insert failed')
        const log = requestLogger?.(request) ?? noopLogger
        log.info('invite.created', {
          inviteId: row.id,
          byUserId: me.id,
          maxUses: row.maxUses,
          expiresAt: row.expiresAt ? row.expiresAt.getTime() : null,
        })
        return toDto(row, me.name)
      },
      {
        teamCaptain: true,
        body: t.Object({
          note: t.Optional(t.String({ maxLength: 100 })),
          maxUses: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
          expiresInDays: t.Optional(t.Integer({ minimum: 1, maximum: 365 })),
        }),
      },
    )
    .post(
      '/:id/revoke',
      async ({ params: { id }, team, status, request, me }) => {
        // another team's id matches nothing here, so the 404 happens before any write
        const [row] = await scope(team).update(
          invites,
          { revokedAt: new Date() },
          eq(invites.id, id),
        )

        if (!row) return status(404, { message: 'Invite not found' })
        const log = requestLogger?.(request) ?? noopLogger
        log.info('invite.revoked', { inviteId: row.id, byUserId: me.id })
        return { ok: true }
      },
      { teamCaptain: true, params: teamParams },
    )
}
