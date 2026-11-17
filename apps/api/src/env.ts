import { join, resolve } from 'node:path'

/** <repo root> — apps/api/src/env.ts -> ../../.. */
export const REPO_ROOT = join(import.meta.dir, '../../..')

const isProduction = process.env.NODE_ENV === 'production'

const secret =
  process.env.BETTER_AUTH_SECRET ??
  (isProduction ? '' : 'dev-only-insecure-secret-please-set-BETTER_AUTH_SECRET')

if (!secret) {
  throw new Error('BETTER_AUTH_SECRET is required in production (openssl rand -base64 32).')
}

const webOrigin = (process.env.WEB_ORIGIN ?? 'http://localhost:5173').replace(/\/$/, '')

export const env = {
  isProduction,
  port: Number(process.env.PORT ?? 3001),
  webOrigin,
  betterAuthUrl: (process.env.BETTER_AUTH_URL ?? webOrigin).replace(/\/$/, ''),
  secret,
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://lol:lol@localhost:5432/lol',
  webDist: resolve(REPO_ROOT, process.env.WEB_DIST ?? 'apps/web/dist'),
  discord: {
    clientId: process.env.DISCORD_CLIENT_ID ?? '',
    clientSecret: process.env.DISCORD_CLIENT_SECRET ?? '',
  },
  captainDiscordIds: (process.env.CAPTAIN_DISCORD_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
  get discordConfigured() {
    return Boolean(this.discord.clientId && this.discord.clientSecret)
  },
  /** true when the configured public URL points at this machine (dev / local container test) */
  get betterAuthIsLocal() {
    try {
      return ['localhost', '127.0.0.1', '::1'].includes(new URL(this.betterAuthUrl).hostname)
    } catch {
      return false
    }
  },
  /** host:port/db without credentials, for logs */
  get databaseTarget() {
    try {
      const url = new URL(this.databaseUrl)
      return `${url.hostname}:${url.port || '5432'}${url.pathname}`
    } catch {
      return 'invalid DATABASE_URL'
    }
  },
}

if (!isProduction) {
  if (!process.env.DATABASE_URL) {
    console.warn(
      '[env] DATABASE_URL not set — falling back to postgres://lol:lol@localhost:5432/lol ' +
        '(docker compose up -d db).',
    )
  }
  if (!env.discordConfigured) {
    console.warn('[env] DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET not set — login will fail.')
  } else {
    console.info(
      `[env] discord login configured (client id …${env.discord.clientId.slice(-5)}, redirect ${env.betterAuthUrl}/api/auth/callback/discord)`,
    )
  }
  if (!process.env.BETTER_AUTH_SECRET) {
    console.warn('[env] Using an insecure dev BETTER_AUTH_SECRET — set it in .env for real use.')
  }
  if (!env.captainDiscordIds.length) {
    console.info('[env] No CAPTAIN_DISCORD_IDS set — the first account to log in becomes captain.')
  }
}
