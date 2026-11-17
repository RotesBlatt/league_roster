import { Elysia } from 'elysia'
import { auth } from '../auth.ts'
import { ensureAccess } from '../lib/access.ts'

/**
 * Route guards used by the API routes:
 *   { auth: true }    -> signed in
 *   { member: true }  -> signed in + approved
 *   { captain: true } -> signed in + approved + captain
 *
 * The better-auth HTTP handler itself is wired up in index.ts via onRequest, because
 * .mount(auth.handler) is only reached when nothing else answers a request.
 */
export const authPlugin = new Elysia({ name: 'auth' }).macro({
  auth: {
    async resolve({ status, request: { headers } }) {
      const session = await auth.api.getSession({ headers })
      if (!session) return status(401, { message: 'Not signed in' })
      return {
        user: session.user,
        session: session.session,
        me: await ensureAccess(session.user.id),
      }
    },
  },
  member: {
    async resolve({ status, request: { headers } }) {
      const session = await auth.api.getSession({ headers })
      if (!session) return status(401, { message: 'Not signed in' })
      const me = await ensureAccess(session.user.id)
      if (me.status !== 'active') return status(403, { message: 'Waiting for approval' })
      return { user: session.user, session: session.session, me }
    },
  },
  captain: {
    async resolve({ status, request: { headers } }) {
      const session = await auth.api.getSession({ headers })
      if (!session) return status(401, { message: 'Not signed in' })
      const me = await ensureAccess(session.user.id)
      if (me.status !== 'active') return status(403, { message: 'Waiting for approval' })
      if (me.role !== 'captain') return status(403, { message: 'Captain only' })
      return { user: session.user, session: session.session, me }
    },
  },
})
