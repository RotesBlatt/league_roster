import { Elysia } from 'elysia'
import { type Auth, auth as defaultAuth } from './auth.ts'
import { type Db, db as defaultDb } from './db/index.ts'
import { env } from './env.ts'
import { createSpa } from './lib/spa.ts'
import { forTeam } from './lib/team-db.ts'
import { createAuthPlugin } from './plugins/auth.ts'
import { createClaimRoutes } from './routes/claim.ts'
import { createInviteRoutes } from './routes/invites.ts'
import { createMeRoutes } from './routes/me.ts'
import { createMemberRoutes } from './routes/members.ts'
import { createPlayerRoutes } from './routes/players.ts'
import { createTeamSettingsRoutes } from './routes/team-settings.ts'
import { createTeamRoutes } from './routes/teams.ts'

export type AppOptions = {
  /** inject a database (tests use a throwaway one) */
  db?: Db
  /** must be created with the same db, when injecting one */
  auth?: Auth
  /** where the built SPA lives; tests point at a fixture */
  spaDist?: string
}

/**
 * Composition root. Everything is injected so `createApp().handle(request)` can be tested
 * in-process against a temporary database, without listening on a port.
 */
export function createApp(options: AppOptions = {}) {
  const db = options.db ?? defaultDb
  const auth = options.auth ?? defaultAuth
  const { spaAssets, serveSpaIndex } = createSpa(options.spaDist ?? env.webDist)
  const authPlugin = createAuthPlugin({ auth, db })

  return (
    new Elysia()
      // better-auth owns /api/auth/*. Intercepted here so it always wins, regardless of which
      // other routes/fallbacks exist (a `.mount()` fetch handler only runs as a last resort).
      .onRequest(({ request, server }) => {
        const { pathname } = new URL(request.url)

        // better-auth needs a client IP for rate limiting. Behind Caddy/nginx the header is
        // already there; without a proxy we take it from the socket.
        if (!request.headers.has('x-forwarded-for') && !request.headers.has('x-real-ip')) {
          const ip = server?.requestIP(request)
          if (ip) request.headers.set('x-real-ip', ip.address)
        }

        if (pathname === '/api/auth' || pathname.startsWith('/api/auth/')) {
          // Replace better-auth's cryptic "Provider not found" with something actionable.
          // Happens when .env has no Discord credentials (or was edited without a restart).
          if (pathname === '/api/auth/sign-in/social' && !env.discordConfigured) {
            return new Response(
              JSON.stringify({
                message:
                  'Discord login is not configured on the server. Set DISCORD_CLIENT_ID and ' +
                  'DISCORD_CLIENT_SECRET in .env, then restart the dev server (env is only read at boot).',
              }),
              { status: 503, headers: { 'content-type': 'application/json' } },
            )
          }
          return auth.handler(request)
        }
      })
      .onError(async ({ code, error, set, request }) => {
        if (code === 'VALIDATION') {
          set.status = 422
          return {
            message: 'Invalid input',
            details: error.all.map((issue) => ({
              path: 'path' in issue ? issue.path : undefined,
              message: issue.message,
            })),
          }
        }
        if (code === 'NOT_FOUND') {
          const { pathname } = new URL(request.url)
          // API and asset paths stay 404s; everything else is a client-side route -> index.html
          if (pathname.startsWith('/api') || pathname.startsWith('/assets')) {
            set.status = 404
            return { message: 'Not found' }
          }
          return serveSpaIndex()
        }
        console.error('[api]', code, error)
        set.status = 500
        return { message: 'Internal error' }
      })
      .use(authPlugin)
      .group('/api', (api) =>
        api
          .get('/health', () => ({ ok: true, uptime: process.uptime() }))
          // global: you can be signed in and not be in a team (yet)
          .use(createMeRoutes(authPlugin))
          // global: the code identifies the team being joined
          .use(createClaimRoutes(db, authPlugin))
          // global: creating a team is the act that makes you its captain, so there is
          // no tenant in the path yet
          .use(createTeamRoutes(db, authPlugin))
          // tenant-scoped, but the `team` table has no `teamId`: the rename needs the plain db
          // plus the guard's team row, so it brings its own /teams/:slug prefix
          .use(createTeamSettingsRoutes(db, authPlugin))
          // tenant-scoped: everything below is addressed by /api/teams/<slug>/...
          .group('/teams/:slug', (team) =>
            team
              // route factories get a scope, not the db: no team in the path, no handle
              .use(createPlayerRoutes((scoped) => forTeam(db, scoped), authPlugin))
              .use(createInviteRoutes((scoped) => forTeam(db, scoped), authPlugin))
              .use(createMemberRoutes((scoped) => forTeam(db, scoped), authPlugin)),
          ),
      )
      // Hashed build output; the SPA shell itself comes from the NOT_FOUND fallback above
      .use(spaAssets)
  )
}

export type App = ReturnType<typeof createApp>
