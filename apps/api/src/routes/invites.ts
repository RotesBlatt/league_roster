import { desc, eq, sql } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import { db } from '../db/index.ts'
import { invites, user } from '../db/schema.ts'
import type { InviteDto } from '../db/schema.types.ts'
import { inviteCode } from '../lib/validate.ts'
import { authPlugin } from '../plugins/auth.ts'

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

export const inviteRoutes = new Elysia({ prefix: '/invites' })
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

      const [invite] = await db.select().from(invites).where(eq(invites.code, code)).limit(1)
      if (!invite) return status(404, { message: 'Invite not found' })
      if (invite.revokedAt) return status(410, { message: 'This invite was revoked' })
      if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
        return status(410, { message: 'This invite expired' })
      }
      if (invite.uses >= invite.maxUses) return status(410, { message: 'This invite is used up' })

      await db.transaction(async (tx) => {
        await tx
          .update(invites)
          .set({ uses: sql`${invites.uses} + 1` })
          .where(eq(invites.id, invite.id))
        await tx
          .update(user)
          .set({ status: 'active', updatedAt: new Date() })
          .where(eq(user.id, me.id))
      })

      return { ...me, status: 'active' as const }
    },
    { auth: true, body: t.Object({ code: t.String({ minLength: 4, maxLength: 64 }) }) },
  )
