import { Elysia } from 'elysia'
import type { Db } from '../db/index.ts'
import type { MatchGamesPage } from '../db/schema.types.ts'
import { parseGamesQuery, readGames } from '../lib/match-read.ts'
import type { AuthPlugin } from '../plugins/auth.ts'

/**
 * `GET /api/teams/:slug/matches` — the games list (match-history.md §9).
 *
 * A `member` right: seeing which games your teammates played is the point of the feature. The
 * refresh-now button, the manual entry and the per-match note are separate routes (and separate
 * patches); this one only reads.
 *
 * No `TeamScope` here, and that is correct rather than an oversight: `match` has no `teamId` by
 * design (§5.2), so there is no tenant column to scope by. The team arrives through `team.id` and
 * becomes the *join* inside `readGames` — never a `WHERE` on the fact tables. The comment there is
 * where the rule lives.
 */
export function createMatchRoutes(db: Db, authPlugin: AuthPlugin) {
  return new Elysia({ prefix: '/matches' }).use(authPlugin).get(
    '/',
    async ({ team, query, status }) => {
      const parsed = parseGamesQuery(query)
      if (!parsed.ok) return status(400, { message: parsed.message })

      const page: MatchGamesPage = await readGames(db, { teamId: team.id, ...parsed.value })
      return page
    },
    { teamMember: true },
  )
}

export type MatchRoutes = ReturnType<typeof createMatchRoutes>
