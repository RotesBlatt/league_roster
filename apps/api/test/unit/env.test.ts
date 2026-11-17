import { describe, expect, test } from 'bun:test'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { readEnv } from '../../src/env.ts'

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

  test('parses the captain allowlist, ignoring blanks', () => {
    const env = readEnv({ ...base, CAPTAIN_DISCORD_IDS: '111, 222 ,,333' }, { warn: false })
    expect(env.captainDiscordIds).toEqual(['111', '222', '333'])
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
