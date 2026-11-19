import { desc, eq } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import type { Db } from '../db/index.ts'
import { invites, user } from '../db/schema.ts'
import type { InviteDto } from '../db/schema.types.ts'
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
 */
export function createInviteRoutes(db: Db, authPlugin: AuthPlugin) {
  return (
    new Elysia({ prefix: '/invites' })
      .use(authPlugin)
      .get(
        '/',
        async ({ team }) => {
          const rows = await db
            .select({ invite: invites, createdByName: user.name })
            .from(invites)
            .leftJoin(user, eq(invites.createdBy, user.id))
            .where(eq(invites.teamId, team.id))
            .orderBy(desc(invites.createdAt))
          return rows.map((row) => toDto(row.invite, row.createdByName))
        },
        { teamCaptain: true },
      )
      .post(
        '/',
        async ({ body, me, team }) => {
          const [row] = await db
            .insert(invites)
            .values({
              id: crypto.randomUUID(),
              code: inviteCode(),
              note: body.note ?? null,
              createdBy: me.id,
              teamId: team.id,
              maxUses: body.maxUses ?? 1,
              expiresAt: body.expiresInDays
                ? new Date(Date.now() + body.expiresInDays * 86_400_000)
                : null,
              createdAt: new Date(),
            })
            .returning()

          if (!row) throw new Error('insert failed')
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
        async ({ params: { id }, team, status }) => {
          const [row] = await db
            .update(invites)
            .set({ revokedAt: new Date() })
            .where(eq(invites.id, id))
            .returning()
          if (!row || row.teamId !== team.id) return status(404, { message: 'Invite not found' })
          return { ok: true }
        },
        { teamCaptain: true, params: teamParams },
      )
  )
}
