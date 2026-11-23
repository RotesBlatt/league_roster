import { Elysia } from 'elysia'
import type { Db } from '../db/index.ts'
import type { ChampionsDto } from '../db/schema.types.ts'
import type { HexserveClient } from '../hexserve/client.ts'
import { loadChampions } from '../hexserve/read.ts'
import type { Logger } from '../lib/log/logger.ts'
import type { AuthPlugin } from '../plugins/auth.ts'

/**
 * `GET /api/champions` (hexserve-champion-data.md §6).
 *
 * Global, not team-scoped: champion ids and names are the same for every team, so putting a tenant
 * in the path would imply a difference that does not exist. It still requires a session — the app
 * is a team tool, and an unauthenticated reference endpoint is surface nobody asked for.
 *
 * There is **no `?patch=` parameter**: the two retained versions are an implementation detail, and
 * a parameter would turn retention into an API contract somebody then asks to expand into an
 * archive (§8).
 *
 * The read is allowed to fetch. That is the whole refresh strategy: no scheduler, no boot-time
 * dependency, self-healing on the first page that asks after a patch lands.
 */
export function createChampionRoutes(
  db: Db,
  hexserve: HexserveClient,
  authPlugin: AuthPlugin,
  logger: Logger,
) {
  return new Elysia({ prefix: '/champions' })
    .use(authPlugin)
    .get('/', (): Promise<ChampionsDto> => loadChampions({ db, client: hexserve, logger }), {
      auth: true,
    })
}
