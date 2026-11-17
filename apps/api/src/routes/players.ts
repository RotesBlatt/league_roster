import { eq, sql } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import { db } from '../db/index.ts'
import { players } from '../db/schema.ts'
import type { PlayerDto } from '../db/schema.types.ts'
import { roleSchema } from '../lib/validate.ts'
import { authPlugin } from '../plugins/auth.ts'

function toDto(row: typeof players.$inferSelect): PlayerDto {
  return {
    id: row.id,
    displayName: row.displayName,
    role: row.role,
    riotGameName: row.riotGameName,
    riotTagLine: row.riotTagLine,
    note: row.note,
    isActive: row.isActive,
    userId: row.userId,
  }
}

const playerBody = t.Object({
  displayName: t.String({ minLength: 1, maxLength: 40 }),
  role: roleSchema,
  riotGameName: t.Optional(t.String({ maxLength: 40 })),
  riotTagLine: t.Optional(t.String({ maxLength: 10 })),
  note: t.Optional(t.String({ maxLength: 500 })),
  isActive: t.Optional(t.Boolean()),
})

export const playerRoutes = new Elysia({ prefix: '/players' })
  .use(authPlugin)
  .get(
    '/',
    async () => {
      // TOP -> JGL -> MID -> ADC -> SUP, not alphabetically
      const roleOrder = sql`CASE ${players.role}
        WHEN 'TOP' THEN 0 WHEN 'JGL' THEN 1 WHEN 'MID' THEN 2 WHEN 'ADC' THEN 3 ELSE 4 END`
      const rows = await db.select().from(players).orderBy(roleOrder, players.displayName)
      return rows.map(toDto)
    },
    { member: true },
  )
  .post(
    '/',
    async ({ body, status }) => {
      const now = new Date()
      const [row] = await db
        .insert(players)
        .values({
          id: crypto.randomUUID(),
          displayName: body.displayName,
          role: body.role,
          // empty form fields must land as NULL, not ''
          riotGameName: body.riotGameName || null,
          riotTagLine: body.riotTagLine || null,
          note: body.note || null,
          isActive: body.isActive ?? true,
          createdAt: now,
          updatedAt: now,
        })
        .returning()

      if (!row) return status(500, { message: 'Could not create player' })
      return toDto(row)
    },
    { captain: true, body: playerBody },
  )
  .patch(
    '/:id',
    async ({ body, params: { id }, status }) => {
      const [row] = await db
        .update(players)
        .set({
          ...(body.displayName !== undefined && { displayName: body.displayName }),
          ...(body.role !== undefined && { role: body.role }),
          ...(body.riotGameName !== undefined && { riotGameName: body.riotGameName || null }),
          ...(body.riotTagLine !== undefined && { riotTagLine: body.riotTagLine || null }),
          ...(body.note !== undefined && { note: body.note || null }),
          ...(body.isActive !== undefined && { isActive: body.isActive }),
          updatedAt: new Date(),
        })
        .where(eq(players.id, id))
        .returning()

      if (!row) return status(404, { message: 'Player not found' })
      return toDto(row)
    },
    {
      captain: true,
      params: t.Object({ id: t.String() }),
      body: t.Partial(playerBody),
    },
  )
  .delete(
    '/:id',
    async ({ params: { id } }) => {
      await db.delete(players).where(eq(players.id, id))
      return { ok: true }
    },
    { captain: true, params: t.Object({ id: t.String() }) },
  )
