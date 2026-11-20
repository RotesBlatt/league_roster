import { describe, expect, test } from 'bun:test'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { REPO_ROOT, readEnv } from '../../src/env.ts'

const base = {
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  DATABASE_URL: 'postgres://user:password@db.example.com:5433/team',
}

describe('readEnv', () => {
  test('falls back to dev defaults', () => {
    const env = readEnv({ BETTER_AUTH_SECRET: 'abc' }, { warn: false })
    expect(env.port).toBe(3001)
    expect(env.webOrigin).toBe('http://localhost:5173')
    expect(env.betterAuthUrl).toBe('http://localhost:5173')
    expect(env.databaseUrl).toBe('postgres://lol:lol@localhost:5432/lol')
    expect(env.isProduction).toBe(false)
  })

  test('strips trailing slashes from origins', () => {
    const env = readEnv(
      {
        ...base,
        WEB_ORIGIN: 'https://lol.example.com/',
        BETTER_AUTH_URL: 'https://lol.example.com//',
      },
      { warn: false },
    )
    expect(env.webOrigin).toBe('https://lol.example.com')
    expect(env.betterAuthUrl).toBe('https://lol.example.com')
  })

  test('databaseTarget never leaks credentials', () => {
    const env = readEnv(base, { warn: false })
    expect(env.databaseTarget).toBe('db.example.com:5433/team')
    expect(env.databaseTarget).not.toContain('password')
  })

  test('databaseTarget survives a malformed url', () => {
    const env = readEnv({ ...base, DATABASE_URL: 'not a url' }, { warn: false })
    expect(env.databaseTarget).toBe('invalid DATABASE_URL')
  })

  test('betterAuthIsLocal is true only for loopback hosts', () => {
    expect(
      readEnv({ ...base, BETTER_AUTH_URL: 'http://localhost:3001' }, { warn: false })
        .betterAuthIsLocal,
    ).toBe(true)
    expect(
      readEnv({ ...base, BETTER_AUTH_URL: 'http://127.0.0.1:3001' }, { warn: false })
        .betterAuthIsLocal,
    ).toBe(true)
    expect(
      readEnv({ ...base, BETTER_AUTH_URL: 'https://lol.example.com' }, { warn: false })
        .betterAuthIsLocal,
    ).toBe(false)
    expect(
      readEnv({ ...base, BETTER_AUTH_URL: 'nonsense' }, { warn: false }).betterAuthIsLocal,
    ).toBe(false)
  })

  test('discord needs both id and secret', () => {
    expect(readEnv({ ...base, DISCORD_CLIENT_ID: 'id' }, { warn: false }).discordConfigured).toBe(
      false,
    )
    expect(
      readEnv({ ...base, DISCORD_CLIENT_ID: 'id', DISCORD_CLIENT_SECRET: 's' }, { warn: false })
        .discordConfigured,
    ).toBe(true)
  })

  test('production without a secret throws instead of using the dev fallback', () => {
    expect(() => readEnv({ NODE_ENV: 'production' }, { warn: false })).toThrow(/BETTER_AUTH_SECRET/)
  })

  test('dev without a secret uses the insecure fallback', () => {
    expect(readEnv({}, { warn: false }).secret).toContain('dev-only')
  })

  test('webDist resolves against the repo root; an absolute path wins over the root', () => {
    const relative = readEnv(base, { warn: false })
    expect(relative.webDist.endsWith(join('apps', 'web', 'dist'))).toBe(true)
    expect(isAbsolute(relative.webDist)).toBe(true)

    const custom = join(tmpdir(), 'built-web')
    const absolute = readEnv({ ...base, WEB_DIST: custom }, { warn: false })
    expect(absolute.webDist).toBe(custom)
  })
})

describe('readEnv log config', () => {
  test('defaults to info, file on, 14 days, assets off, slow 500ms', () => {
    const env = readEnv(base, { warn: false })
    expect(env.log.level).toBe('info')
    expect(env.log.toFile).toBe(true)
    expect(env.log.dir).toBe(resolve(REPO_ROOT, 'logs'))
    expect(env.log.retentionDays).toBe(14)
    expect(env.log.assets).toBe(false)
    expect(env.log.slowMs).toBe(500)
  })

  test('LOG_LEVEL accepts the four levels and falls back to info', () => {
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      expect(readEnv({ ...base, LOG_LEVEL: level }, { warn: false }).log.level).toBe(level)
    }
    expect(readEnv({ ...base, LOG_LEVEL: 'trace' }, { warn: false }).log.level).toBe('info')
    expect(readEnv({ ...base, LOG_LEVEL: '' }, { warn: false }).log.level).toBe('info')
  })

  test('booleans accept true/false and their numeric forms', () => {
    const withLog = (value: string) =>
      readEnv({ ...base, LOG_TO_FILE: value, LOG_ASSETS: value }, { warn: false }).log
    expect(withLog('false').toFile).toBe(false)
    expect(withLog('0').toFile).toBe(false)
    expect(withLog('true').toFile).toBe(true)
    expect(withLog('1').toFile).toBe(true)
    expect(withLog('true').assets).toBe(true)
    expect(readEnv(base, { warn: false }).log.assets).toBe(false)
  })

  test('LOG_DIR resolves against the repo root; an absolute path wins', () => {
    expect(readEnv({ ...base, LOG_DIR: 'var/logs' }, { warn: false }).log.dir).toBe(
      resolve(REPO_ROOT, 'var/logs'),
    )
    const absolute = join(tmpdir(), 'api-logs')
    expect(readEnv({ ...base, LOG_DIR: absolute }, { warn: false }).log.dir).toBe(absolute)
  })

  test('numbers fall back to their defaults when invalid', () => {
    expect(readEnv({ ...base, LOG_RETENTION_DAYS: '30' }, { warn: false }).log.retentionDays).toBe(
      30,
    )
    expect(readEnv({ ...base, LOG_RETENTION_DAYS: 'abc' }, { warn: false }).log.retentionDays).toBe(
      14,
    )
    expect(readEnv({ ...base, LOG_RETENTION_DAYS: '0' }, { warn: false }).log.retentionDays).toBe(
      14,
    )
    expect(readEnv({ ...base, LOG_SLOW_MS: '1000' }, { warn: false }).log.slowMs).toBe(1000)
    expect(readEnv({ ...base, LOG_SLOW_MS: '-5' }, { warn: false }).log.slowMs).toBe(500)
    expect(readEnv({ ...base, LOG_SLOW_MS: 'abc' }, { warn: false }).log.slowMs).toBe(500)
  })
})
