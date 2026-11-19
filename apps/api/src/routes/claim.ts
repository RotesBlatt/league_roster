import { Elysia, t } from 'elysia'
import type { Db } from '../db/index.ts'
import { getMe } from '../lib/access.ts'
import { claimInvite } from '../lib/invites.ts'
import type { AuthPlugin } from '../plugins/auth.ts'

/**
 * Global on purpose: the code identifies the team, so the claimer does not need to know
 * the slug yet. This is the only write outside /api/teams/:slug.
 */
export function createClaimRoutes(db: Db, authPlugin: AuthPlugin) {
  return new Elysia({ prefix: '/invites' }).use(authPlugin).post(
    '/claim',
    async ({ body: { code }, me, status }) => {
      if (me.status === 'active') return me

      const result = await claimInvite(db, { userId: me.id, code })
      if (!result.ok) return status(result.status, { message: result.message })
      // re-read: the membership now exists, so the SPA gets a teamSlug to navigate to
      return (await getMe(db, me.id)) ?? me
    },
    { auth: true, body: t.Object({ code: t.String({ minLength: 4, maxLength: 64 }) }) },
  )
}
