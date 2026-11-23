import { join, resolve } from 'node:path'
import { HEXSERVE_BASE_URL } from './hexserve/client.ts'

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
  const riot = {
    // trailing whitespace and a newline survive a copy-paste into .env; trim them here, once
    apiKey: (source.RIOT_API_KEY ?? '').trim(),
  }
  // One base URL for the dump, overridable per deploy: `dump-collector.de` is a hobby domain and
  // will outlive its name (hexserve-champion-data.md §9.7). The default lives in the client so a
  // fresh checkout works without a .env entry. A blank value is not a URL — the default stands.
  const hexserve = {
    baseUrl: (source.HEXSERVE_BASE_URL?.trim() || HEXSERVE_BASE_URL).replace(/\/+$/, ''),
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
    riot,
    hexserve,
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
    /**
     * The key is the only switch: present means the lookup may call Riot, absent means it never
     * does. There is deliberately no second flag — "configured but disabled" is a state nobody
     * can explain in a bug report (riot-api.md §7, simplified).
     */
    get riotConfigured() {
      return riot.apiKey.length > 0
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
    // the key itself is a secret: say whether the lookup is on, never what it is
    if (env.riotConfigured) console.info('[env] riot lookup enabled')
  }

  return env
}

export type Env = ReturnType<typeof readEnv>

export const env = readEnv()
