import { Elysia } from 'elysia'
import { type Auth, auth as defaultAuth } from './auth.ts'
import { type Db, db as defaultDb } from './db/index.ts'
import { env } from './env.ts'
import { createRequestLog } from './lib/log/http.ts'
import type { Logger } from './lib/log/logger.ts'
import { noopLogger } from './lib/log/noop.ts'
import { createSpa } from './lib/spa.ts'
import { forTeam } from './lib/team-db.ts'
import { createAuthPlugin } from './plugins/auth.ts'
import { createRiotClient, type RiotClient } from './riot/client.ts'
import { createThrottle, type Throttle } from './riot/throttle.ts'
import { createClaimRoutes } from './routes/claim.ts'
import { createInviteRoutes } from './routes/invites.ts'
import { createMeRoutes } from './routes/me.ts'
import { createMemberRoutes } from './routes/members.ts'
import { createPlannerRoutes } from './routes/planner.ts'
import { createProfileRoutes } from './routes/profile.ts'
import { createRiotAccountRoutes } from './routes/riot-accounts.ts'
import { createRosterRoutes } from './routes/roster.ts'
import { createTeamSettingsRoutes } from './routes/team-settings.ts'
import { createTeamRoutes } from './routes/teams.ts'

export type AppOptions = {
  /** inject a database (tests use a throwaway one) */
  db?: Db
  /** must be created with the same db, when injecting one */
  auth?: Auth
  /** where the built SPA lives; tests point at a fixture */
  spaDist?: string
  /** silent by default; `index.ts` builds the real one, tests inject a capture */
  logger?: Logger
  /**
   * inject a Riot client. The default is built from `RIOT_API_KEY`; with no key it answers
   * `forbidden` without ever calling out, so "no key, no request" cannot be forgotten by a route.
   */
  riot?: RiotClient
  /** per-user lookup budget; tests shrink it to one instead of looping eleven times */
  riotThrottle?: Throttle
}

/**
 * Composition root. Everything is injected so `createApp().handle(request)` can be tested
 * in-process against a temporary database, without listening on a port.
 */
export function createApp(options: AppOptions = {}) {
  const db = options.db ?? defaultDb
  const auth = options.auth ?? defaultAuth
  const logger = options.logger ?? noopLogger
  const { spaAssets, serveSpaIndex } = createSpa(options.spaDist ?? env.webDist)
  const requestLog = createRequestLog({
    logger,
    slowMs: env.log.slowMs,
    logAssets: env.log.assets,
  })
  const requestLogger = (request: Request) => requestLog.requestLogger(request)
  const authPlugin = createAuthPlugin({ auth, db, requestLogger })
  const riot = options.riot ?? createRiotClient({ apiKey: env.riot.apiKey })
  const riotThrottle = options.riotThrottle ?? createThrottle()

  return (
    new Elysia()
      // better-auth owns /api/auth/*. Intercepted here so it always wins, regardless of which
      // other routes/fallbacks exist (a `.mount()` fetch handler only runs as a last resort).
      .onRequest(async ({ request, set, server }) => {
        const { pathname } = new URL(request.url)

        // better-auth needs a client IP for rate limiting. Behind Caddy/nginx the header is
        // already there; without a proxy we take it from the socket.
        if (!request.headers.has('x-forwarded-for') && !request.headers.has('x-real-ip')) {
          const ip = server?.requestIP(request)
          if (ip) request.headers.set('x-real-ip', ip.address)
        }

        // after the ip header is set, so the record sees it; before any early return below
        requestLog.onRequest({ request, set })

        if (pathname === '/api/auth' || pathname.startsWith('/api/auth/')) {
          let response: Response
          if (pathname === '/api/auth/sign-in/social' && !env.discordConfigured) {
            // Replace better-auth's cryptic "Provider not found" with something actionable.
            // Happens when .env has no Discord credentials (or was edited without a restart).
            response = new Response(
              JSON.stringify({
                message:
                  'Discord login is not configured on the server. Set DISCORD_CLIENT_ID and ' +
                  'DISCORD_CLIENT_SECRET in .env, then restart the dev server (env is only read at boot).',
              }),
              { status: 503, headers: { 'content-type': 'application/json' } },
            )
          } else {
            response = await auth.handler(request)
          }
          // better-auth answered inside onRequest, where onAfterResponse never runs
          requestLog.logShortCircuit(request, response)
          return response
        }
      })
      .onError(async ({ code, error, set, request }) => {
        if (code === 'VALIDATION') {
          set.status = 422
          const body = {
            message: 'Invalid input',
            details: error.all.map((issue) => ({
              path: 'path' in issue ? issue.path : undefined,
              message: issue.message,
            })),
          }
          requestLog.onError({ request, set, code, error, message: body.message })
          return body
        }
        if (code === 'NOT_FOUND') {
          const { pathname } = new URL(request.url)
          // API and asset paths stay 404s; everything else is a client-side route -> index.html
          if (pathname.startsWith('/api') || pathname.startsWith('/assets')) {
            set.status = 404
            const body = { message: 'Not found' }
            requestLog.onError({ request, set, code, error, message: body.message })
            return body
          }
          requestLog.onError({ request, set, code, error })
          return serveSpaIndex()
        }
        // No console.error: the 5xx http.request line already carries the code and stack.
        set.status = 500
        const body = { message: 'Internal error' }
        requestLog.onError({ request, set, code, error, message: body.message })
        return body
      })
      .onAfterHandle(requestLog.onAfterHandle)
      .onAfterResponse(requestLog.onAfterResponse)
      .use(authPlugin)
      .group('/api', (api) =>
        api
          .get('/health', () => ({ ok: true, uptime: process.uptime() }))
          // global: you can be signed in and not be in a team (yet)
          .use(createMeRoutes(authPlugin))
          // global: a person's own profile exists before (and without) any team
          .use(createProfileRoutes(db, authPlugin, requestLogger))
          // global: the accounts belong to the person, not to a team
          .use(createRiotAccountRoutes(db, riot, riotThrottle, authPlugin, requestLogger))
          // global: the code identifies the team being joined
          .use(createClaimRoutes(db, authPlugin, requestLogger))
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
              // the new roster: a join over what replaced the old `player` table
              .use(createRosterRoutes(db, (scoped) => forTeam(db, scoped), authPlugin))
              // the week planner: reads are derived, writes are personal and week-scoped
              .use(createPlannerRoutes(db, (scoped) => forTeam(db, scoped), authPlugin))
              .use(createInviteRoutes((scoped) => forTeam(db, scoped), authPlugin, requestLogger))
              .use(
                createMemberRoutes(db, (scoped) => forTeam(db, scoped), authPlugin, requestLogger),
              ),
          ),
      )
      // Hashed build output; the SPA shell itself comes from the NOT_FOUND fallback above
      .use(spaAssets)
  )
}

export type App = ReturnType<typeof createApp>
