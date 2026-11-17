import { Elysia } from 'elysia'
import { auth, trustedOrigins } from './auth.ts'
import { client } from './db/index.ts'
import { env } from './env.ts'
import { serveSpaIndex, spaAssets } from './lib/spa.ts'
import { authPlugin } from './plugins/auth.ts'
import { inviteRoutes } from './routes/invites.ts'
import { meRoutes } from './routes/me.ts'
import { memberRoutes } from './routes/members.ts'
import { playerRoutes } from './routes/players.ts'

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? ` (${error.code})` : ''
    return `${error.message || error.name}${code}`
  }
  return String(error)
}

// Fail fast and actionably, instead of erroring on the first request.
try {
  await client`select 1`
  console.info(`[db] connected to ${env.databaseTarget}`)
} catch (error) {
  console.error(
    `[db] cannot reach Postgres at ${env.databaseTarget}.\n` +
      '  local dev:  docker compose up -d db\n' +
      '  otherwise:  check DATABASE_URL in .env\n' +
      `  cause: ${describeError(error)}`,
  )
  process.exit(1)
}

const app = new Elysia()
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
      .use(meRoutes)
      .use(playerRoutes)
      .use(inviteRoutes)
      .use(memberRoutes),
  )
  .use(spaAssets)
  .listen(env.port)

console.info(`[api] listening on http://localhost:${app.server?.port} (db: ${env.databaseTarget})`)
console.info(
  `[auth] baseURL ${env.betterAuthUrl} · trusted origins: ${trustedOrigins.join(', ')}`,
)

export type App = typeof app
