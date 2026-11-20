import { join, resolve } from 'node:path'

/** <repo root> — apps/api/src/env.ts -> ../../.. */
export const REPO_ROOT = join(import.meta.dir, '../../..')

export type EnvSource = Record<string, string | undefined>

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const

export type LogLevel = (typeof LOG_LEVELS)[number]

/** `true`/`1` and `false`/`0`, anything else (including unset) gives the default. */
function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback
  const normalized = value.toLowerCase()
  if (normalized === 'true' || normalized === '1') return true
  if (normalized === 'false' || normalized === '0') return false
  return fallback
}

/** A positive whole number, or the default. Log config is silent — no warnings. */
function envPositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function envLogLevel(value: string | undefined): LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value ?? '') ? (value as LogLevel) : 'info'
}

/** Pure reader so tests can exercise parsing without touching process.env. */
export function readEnv(source: EnvSource = process.env, options: { warn?: boolean } = {}) {
  const warn = options.warn ?? source === process.env
  const isProduction = source.NODE_ENV === 'production'

  const secret =
    source.BETTER_AUTH_SECRET ??
    (isProduction ? '' : 'dev-only-insecure-secret-please-set-BETTER_AUTH_SECRET')
  if (!secret) {
    throw new Error('BETTER_AUTH_SECRET is required in production (openssl rand -base64 32).')
  }

  const webOrigin = (source.WEB_ORIGIN ?? 'http://localhost:5173').replace(/\/+$/, '')
  const betterAuthUrl = (source.BETTER_AUTH_URL ?? webOrigin).replace(/\/+$/, '')
  const databaseUrl = source.DATABASE_URL ?? 'postgres://lol:lol@localhost:5432/lol'
  const discord = {
    clientId: source.DISCORD_CLIENT_ID ?? '',
    clientSecret: source.DISCORD_CLIENT_SECRET ?? '',
  }

  const env = {
    isProduction,
    port: Number(source.PORT ?? 3001),
    webOrigin,
    betterAuthUrl,
    secret,
    databaseUrl,
    webDist: resolve(REPO_ROOT, source.WEB_DIST ?? 'apps/web/dist'),
    discord,
    log: {
      level: envLogLevel(source.LOG_LEVEL),
      toFile: envBool(source.LOG_TO_FILE, true),
      dir: resolve(REPO_ROOT, source.LOG_DIR ?? 'logs'),
      retentionDays: envPositiveInt(source.LOG_RETENTION_DAYS, 14),
      assets: envBool(source.LOG_ASSETS, false),
      slowMs: envPositiveInt(source.LOG_SLOW_MS, 500),
    },

    get discordConfigured() {
      return Boolean(discord.clientId && discord.clientSecret)
    },
    /** host:port/db without credentials, for logs */
    get databaseTarget() {
      try {
        const url = new URL(databaseUrl)
        return `${url.hostname}:${url.port || '5432'}${url.pathname}`
      } catch {
        return 'invalid DATABASE_URL'
      }
    },
    /** true when the configured public URL points at this machine */
    get betterAuthIsLocal() {
      try {
        return ['localhost', '127.0.0.1', '::1'].includes(new URL(betterAuthUrl).hostname)
      } catch {
        return false
      }
    },
  }

  if (warn && !isProduction) {
    if (!source.DATABASE_URL) {
      console.warn(
        '[env] DATABASE_URL not set — falling back to postgres://lol:lol@localhost:5432/lol ' +
          '(docker compose up -d db).',
      )
    }
    if (!env.discordConfigured) {
      console.warn('[env] DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET not set — login will fail.')
    } else {
      console.info(
        `[env] discord login configured (client id …${discord.clientId.slice(-5)}, redirect ${betterAuthUrl}/api/auth/callback/discord)`,
      )
    }
    if (!source.BETTER_AUTH_SECRET) {
      console.warn('[env] Using an insecure dev BETTER_AUTH_SECRET — set it in .env for real use.')
    }
  }

  return env
}

export type Env = ReturnType<typeof readEnv>

export const env = readEnv()
