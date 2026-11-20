import { eq, sql } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import { players } from '../db/schema.ts'
import type { PlayerDto } from '../db/schema.types.ts'
import type { TeamScope } from '../lib/team-db.ts'
import { roleSchema, teamParams } from '../lib/validate.ts'
import type { AuthPlugin } from '../plugins/auth.ts'

function toDto(row: typeof players.$inferSelect): PlayerDto {
  return {
    id: row.id,
    displayName: row.displayName,
    role: row.role,
    riotGameName: row.riotGameName,
    riotTagLine: row.riotTagLine,
    teamId: row.teamId,
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

/**
 * Mounted under /api/teams/:slug. It receives a `scope`, never the raw `db`: every query goes
 * through `forTeam(team)`, so no handler here can address another team's roster — not even by
 * passing its player id. The `where` that used to be remembered is now the only thing the
 * handle can express (multi-team.md §5).
 */
export function createPlayerRoutes(scope: TeamScope, authPlugin: AuthPlugin) {
  return new Elysia({ prefix: '/players' })
    .use(authPlugin)
    .get(
      '/',
      async ({ team }) => {
        // TOP -> JGL -> MID -> ADC -> SUP, not alphabetically
        const roleOrder = sql`CASE ${players.role}
          WHEN 'TOP' THEN 0 WHEN 'JGL' THEN 1 WHEN 'MID' THEN 2 WHEN 'ADC' THEN 3 ELSE 4 END`
        const rows = await scope(team).selectFrom(players, undefined, {
          orderBy: [roleOrder, players.displayName],
        })
        return rows.map(toDto)
      },
      { teamMember: true },
    )
    .post(
      '/',
      async ({ body, team, status }) => {
        const now = new Date()
        // no teamId in the values: the scope injects it
        const row = await scope(team).insertInto(players, {
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

        if (!row) return status(500, { message: 'Could not create player' })
        return toDto(row)
      },
      { teamCaptain: true, body: playerBody },
    )
    .patch(
      '/:id',
      async ({ body, params: { id }, team, status }) => {
        // the team predicate comes from the scope; `id` only narrows within it
        const [row] = await scope(team).update(
          players,
          {
            ...(body.displayName !== undefined && { displayName: body.displayName }),
            ...(body.role !== undefined && { role: body.role }),
            ...(body.riotGameName !== undefined && { riotGameName: body.riotGameName || null }),
            ...(body.riotTagLine !== undefined && { riotTagLine: body.riotTagLine || null }),
            ...(body.note !== undefined && { note: body.note || null }),
            ...(body.isActive !== undefined && { isActive: body.isActive }),
            updatedAt: new Date(),
          },
          eq(players.id, id),
        )

        if (!row) return status(404, { message: 'Player not found' })
        return toDto(row)
      },
      {
        teamCaptain: true,
        params: teamParams,
        body: t.Partial(playerBody),
      },
    )
    .delete(
      '/:id',
      async ({ params: { id }, team, status }) => {
        // returning rows so "not found" and "deleted" stay distinguishable: a silent 200 on
        // another team's player id would be a lie (and a cross-team one)
        const deleted = await scope(team).deleteFrom(players, eq(players.id, id))

        if (deleted.length === 0) return status(404, { message: 'Player not found' })
        return { ok: true }
      },
      { teamCaptain: true, params: teamParams },
    )
}

export type PlayerRoutes = ReturnType<typeof createPlayerRoutes>
