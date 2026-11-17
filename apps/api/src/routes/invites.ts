import { desc, eq } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import type { Db } from '../db/index.ts'
import { invites, user } from '../db/schema.ts'
import type { InviteDto } from '../db/schema.types.ts'
import { claimInvite } from '../lib/invites.ts'
import { inviteCode } from '../lib/validate.ts'
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

export function createInviteRoutes(db: Db, authPlugin: AuthPlugin) {
  return (
    new Elysia({ prefix: '/invites' })
      .use(authPlugin)
      .get(
        '/',
        async () => {
          const rows = await db
            .select({ invite: invites, createdByName: user.name })
            .from(invites)
            .leftJoin(user, eq(invites.createdBy, user.id))
            .orderBy(desc(invites.createdAt))
          return rows.map((row) => toDto(row.invite, row.createdByName))
        },
        { captain: true },
      )
      .post(
        '/',
        async ({ body, me }) => {
          const [row] = await db
            .insert(invites)
            .values({
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
            .returning()

          if (!row) throw new Error('insert failed')
          return toDto(row, me.name)
        },
        {
          captain: true,
          body: t.Object({
            note: t.Optional(t.String({ maxLength: 100 })),
            maxUses: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
            expiresInDays: t.Optional(t.Integer({ minimum: 1, maximum: 365 })),
          }),
        },
      )
      .post(
        '/:id/revoke',
        async ({ params: { id }, status }) => {
          const [row] = await db
            .update(invites)
            .set({ revokedAt: new Date() })
            .where(eq(invites.id, id))
            .returning()
          if (!row) return status(404, { message: 'Invite not found' })
          return { ok: true }
        },
        { captain: true, params: t.Object({ id: t.String() }) },
      )
      /** Any signed-in account can try to claim a code (that's how a fresh install onboards). */
      .post(
        '/claim',
        async ({ body: { code }, me, status }) => {
          if (me.status === 'active') return me

          const result = await claimInvite(db, { userId: me.id, code })
          if (!result.ok) return status(result.status, { message: result.message })
          return { ...me, status: 'active' as const }
        },
        { auth: true, body: t.Object({ code: t.String({ minLength: 4, maxLength: 64 }) }) },
      )
  )
}
