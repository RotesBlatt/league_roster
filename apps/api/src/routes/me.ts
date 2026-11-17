import { Elysia } from 'elysia'
import { authPlugin } from '../plugins/auth.ts'

export const meRoutes = new Elysia({ prefix: '/me' })
  .use(authPlugin)
  /** Called on every app boot by the SPA: hydrates role/status and runs bootstrap. */
  .get('/', ({ me }) => me, { auth: true })
