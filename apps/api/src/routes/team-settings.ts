import { Elysia } from 'elysia'
import type { Db } from '../db/index.ts'
import type { TeamDto } from '../db/schema.types.ts'
import { renameTeam } from '../lib/teams.ts'
import { teamBody } from '../lib/validate.ts'
import type { AuthPlugin } from '../plugins/auth.ts'

/**
 * The team's own identity — the one team-scoped route that does *not* get a `TeamScope`.
 * `forTeam` exists to make "every query carries `teamId`" structural, and the `team` table is
 * addressed by its primary key, which the guard already resolved from the slug (team-rename.md §3).
 *
 * It carries its own `/teams/:slug` prefix instead of joining the group in app.ts, because that
 * group only hands out scopes.
 */
export function createTeamSettingsRoutes(db: Db, authPlugin: AuthPlugin) {
  return (
    new Elysia({ prefix: '/teams/:slug' })
      .use(authPlugin)
      /**
       * Rename. Captain only; the slug is derived from the name, so the answer carries the new one —
       * the SPA has to navigate, or it would keep talking to a slug that no longer exists.
       */
      .patch(
        '/',
        async ({ body, team, status }) => {
          const result = await renameTeam(db, {
            team,
            name: body.name,
            shortName: body.shortName,
          })
          if (!result.ok) return status(result.status, { message: result.message })

          const { id, slug, name, shortName } = result.team
          return { id, slug, name, shortName } satisfies TeamDto
        },
        { teamCaptain: true, body: teamBody },
      )
  )
}

export type TeamSettingsRoutes = ReturnType<typeof createTeamSettingsRoutes>
