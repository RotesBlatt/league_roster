import { SHORT_NAME_MAX, TEAM_NAME_MAX } from '@lol/shared'
import { Elysia, t } from 'elysia'
import type { Db } from '../db/index.ts'
import { meForTeam } from '../lib/access.ts'
import { createTeam, listTeamsForUser } from '../lib/teams.ts'
import type { AuthPlugin } from '../plugins/auth.ts'

const teamBody = t.Object({
  name: t.String({ minLength: 1, maxLength: TEAM_NAME_MAX }),
  // optional badge tag ("DBW"); the rule itself lives in createTeam, this only bounds the input
  shortName: t.Optional(t.String({ maxLength: SHORT_NAME_MAX })),
})

/**
 * Mounted at /api/teams — the one team route that is *not* under /api/teams/:slug,
 * because the team does not exist yet when the request arrives.
 *
 * `auth: true` is enough: creating a team is exactly what makes you its captain
 * (multi-team.md §4), so there is no team to be a member of beforehand.
 */
export function createTeamRoutes(db: Db, authPlugin: AuthPlugin) {
  return (
    new Elysia({ prefix: '/teams' })
      .use(authPlugin)
      /** The teams I may act as — what the switcher lists. Empty for a team-less account. */
      .get('/', async ({ me }) => listTeamsForUser(db, me.id), { auth: true })
      .post(
        '/',
        async ({ body, me, status }) => {
          const result = await createTeam(db, {
            userId: me.id,
            name: body.name,
            shortName: body.shortName ?? null,
          })
          if (!result.ok) return status(result.status, { message: result.message })

          // `Me` for the new team: the SPA has nowhere to go until it knows the slug
          return meForTeam(
            { id: me.id, name: me.name, email: me.email, image: me.image },
            result.team,
            result.membership,
          )
        },
        { auth: true, body: teamBody },
      )
  )
}

export type TeamRoutes = ReturnType<typeof createTeamRoutes>
