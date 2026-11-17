import { and, count, desc, eq } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import { db } from '../db/index.ts'
import { players, user } from '../db/schema.ts'
import type { MemberDto } from '../db/schema.types.ts'
import { memberStatusSchema, userRoleSchema } from '../lib/validate.ts'
import { authPlugin } from '../plugins/auth.ts'

export const memberRoutes = new Elysia({ prefix: '/members' })
  .use(authPlugin)
  /** Everyone on the server, including pending ones (captain uses this as an approval queue). */
  .get(
    '/',
    async () => {
      const rows = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
          status: user.status,
          createdAt: user.createdAt,
          playerId: players.id,
        })
        .from(user)
        .leftJoin(players, eq(players.userId, user.id))
        .orderBy(desc(user.createdAt))

      return rows.map<MemberDto>((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        image: row.image,
        role: row.role,
        status: row.status,
        createdAt: row.createdAt.getTime(),
        hasPlayer: Boolean(row.playerId),
      }))
    },
    { captain: true },
  )
  .patch(
    '/:id',
    async ({ body, params: { id }, status, me }) => {
      const [target] = await db.select().from(user).where(eq(user.id, id)).limit(1)
      if (!target) return status(404, { message: 'Member not found' })

      const demotingCaptain =
        target.role === 'captain' && (body.role === 'member' || body.status === 'disabled')
      if (demotingCaptain) {
        const [row] = await db
          .select({ value: count() })
          .from(user)
          .where(and(eq(user.role, 'captain'), eq(user.status, 'active')))
        if ((row?.value ?? 0) <= 1) {
          return status(409, { message: 'There has to be at least one active captain' })
        }
      }
      if (target.id === me.id && body.status === 'disabled') {
        return status(409, { message: 'You cannot disable your own account' })
      }

      const [updated] = await db
        .update(user)
        .set({
          ...(body.role !== undefined && { role: body.role }),
          ...(body.status !== undefined && { status: body.status }),
          updatedAt: new Date(),
        })
        .where(eq(user.id, id))
        .returning()

      if (!updated) return status(500, { message: 'Update failed' })
      return { ok: true }
    },
    {
      captain: true,
      params: t.Object({ id: t.String() }),
      // t.Partial keeps the literal types; t.Optional(UnionEnum(...)) collapses them to undefined.
      body: t.Partial(t.Object({ role: userRoleSchema, status: memberStatusSchema })),
    },
  )
