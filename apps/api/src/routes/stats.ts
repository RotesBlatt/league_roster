import { Elysia } from 'elysia'
import type { Db } from '../db/index.ts'
import type { TeamStatsDto } from '../db/schema.types.ts'
import { readTeamStats } from '../lib/match-stats-read.ts'
import type { AuthPlugin } from '../plugins/auth.ts'

/**
 * `GET /api/teams/:slug/stats` — every player's champion stats (match-history.md §8, §9).
 *
 * A `member` right, like the games list: the table is the team's own record of itself. There is no
 * scope parameter — the page shows all games, by product decision, and `readTeamStats` owns that
 * choice rather than a default hidden in a route.
 */
export function createStatsRoutes(db: Db, authPlugin: AuthPlugin) {
  return new Elysia({ prefix: '/stats' })
    .use(authPlugin)
    .get('/', async ({ team }): Promise<TeamStatsDto> => readTeamStats(db, { teamId: team.id }), {
      teamMember: true,
    })
}

export type StatsRoutes = ReturnType<typeof createStatsRoutes>
