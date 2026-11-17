import { Elysia } from 'elysia'
import type { AuthPlugin } from '../plugins/auth.ts'

export function createMeRoutes(authPlugin: AuthPlugin) {
  return (
    new Elysia({ prefix: '/me' })
      .use(authPlugin)
      /** Called on every app boot by the SPA: hydrates role/status and runs bootstrap. */
      .get('/', ({ me }) => me, { auth: true })
  )
}
