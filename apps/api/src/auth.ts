import { betterAuth } from 'better-auth'
import { authDatabase } from './db/index.ts'
import { env } from './env.ts'

/**
 * Origins allowed to call /api/auth/*.
 * WEB_ORIGIN is the Vite dev server, BETTER_AUTH_URL the deployed origin. When the public URL
 * points at this machine we also trust the API's own port, because `docker compose up` serves
 * the SPA and the API from http://localhost:<PORT> (no Vite in between).
 */
export const trustedOrigins = [
  ...new Set([
    env.webOrigin,
    env.betterAuthUrl,
    ...(env.betterAuthIsLocal
      ? [`http://localhost:${env.port}`, `http://127.0.0.1:${env.port}`]
      : []),
  ]),
]

export const auth = betterAuth({
  baseURL: env.betterAuthUrl,
  secret: env.secret,
  database: authDatabase,

  trustedOrigins,

  socialProviders: env.discordConfigured
    ? {
        // better-auth already requests identify+email for Discord; no custom scope needed.
        discord: {
          clientId: env.discord.clientId,
          clientSecret: env.discord.clientSecret,
        },
      }
    : {},

  // Discord only. No passwords to store.
  emailAndPassword: { enabled: false },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24,
  },

  user: {
    // Never settable from the client — only our routes touch these.
    additionalFields: {
      role: { type: 'string', required: false, defaultValue: 'member', input: false },
      status: { type: 'string', required: false, defaultValue: 'pending', input: false },
    },
  },

  advanced: {
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: 'lax',
      // Derived from the actual origin, not NODE_ENV: a container on http://localhost:3001
      // runs with NODE_ENV=production, and browsers drop `secure` cookies over plain http.
      secure: env.betterAuthUrl.startsWith('https://'),
    },
    // Behind Caddy/nginx the client IP arrives in x-forwarded-for; without it better-auth
    // falls back to one shared rate-limit bucket per path.
    ipAddress: { ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'] },
  },
})

export type AuthSession = typeof auth.$Infer.Session
