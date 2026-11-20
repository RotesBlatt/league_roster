import { Elysia, t } from 'elysia'
import type { Db } from '../db/index.ts'
import { getMe } from '../lib/access.ts'
import { claimInvite } from '../lib/invites.ts'
import type { Logger } from '../lib/log/logger.ts'
import { noopLogger } from '../lib/log/noop.ts'
import type { AuthPlugin } from '../plugins/auth.ts'

/**
 * Global on purpose: the code identifies the team, so the claimer does not need to know
 * the slug yet. This is the only write outside /api/teams/:slug.
 */
export function createClaimRoutes(
  db: Db,
  authPlugin: AuthPlugin,
  requestLogger?: (request: Request) => Logger,
) {
  return new Elysia({ prefix: '/invites' }).use(authPlugin).post(
    '/claim',
    async ({ body: { code }, me, status, request }) => {
      if (me.status === 'active') return me

      const log = requestLogger?.(request) ?? noopLogger
      const result = await claimInvite(db, { userId: me.id, code, log })
      if (!result.ok) return status(result.status, { message: result.message })
      // re-read: the membership now exists, so the SPA gets a teamSlug to navigate to
      return (await getMe(db, me.id)) ?? me
    },
    { auth: true, body: t.Object({ code: t.String({ minLength: 4, maxLength: 64 }) }) },
  )
}
