import { Elysia } from 'elysia'
import type { Db } from '../db/index.ts'
import type { MatchGamesPage } from '../db/schema.types.ts'
import { createManualMatch } from '../lib/manual-match-write.ts'
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
  return (
    new Elysia({ prefix: '/matches' })
      .use(authPlugin)
      .get(
        '/',
        async ({ team, query, status }) => {
          const parsed = parseGamesQuery(query)
          if (!parsed.ok) return status(400, { message: parsed.message })

          const page: MatchGamesPage = await readGames(db, { teamId: team.id, ...parsed.value })
          return page
        },
        { teamMember: true },
      )
      /**
       * Enter a scrim by hand (§5.8). **Any member may enter, edit and delete** (§10.14, decided
       * 2026-11-27) — a teammate who played is the one who wants the row to exist, and a captain-only
       * form is a form that does not get filled in at 23:30.
       *
       * No `body` schema here on purpose: `validateManualMatch` owns the shape and reports **every**
       * problem at once, which an Elysia schema would turn into one message at a time.
       */
      .post(
        '/',
        async ({ team, body, me, status }) => {
          const result = await createManualMatch(db, {
            teamId: team.id,
            createdBy: me.id,
            body,
          })
          if (!result.ok) return status(result.status, { message: result.message })

          return status(201, { matchId: result.matchId })
        },
        { teamMember: true },
      )
  )
}

export type MatchRoutes = ReturnType<typeof createMatchRoutes>
