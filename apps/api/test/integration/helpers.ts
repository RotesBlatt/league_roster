import { createHmac } from 'node:crypto'
import { join } from 'node:path'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { createApp } from '../../src/app.ts'
import { type Auth, createAuth } from '../../src/auth.ts'
import { createDb, type Db } from '../../src/db/index.ts'
import { account, session, user } from '../../src/db/schema.ts'
import { env } from '../../src/env.ts'

const adminUrl = process.env.TEST_DATABASE_URL
if (!adminUrl) {
  throw new Error('TEST_DATABASE_URL is not set — run `bun run test:db` instead of `bun test`.')
}

export type TestContext = {
  db: Db
  auth: Auth
  url: string
  close: () => Promise<void>
  drop: () => Promise<void>
}

/** Creates a throwaway database, migrates it, and returns a wired context. */
export async function createTestContext(): Promise<TestContext> {
  const name = `lol_test_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
  const admin = postgres(adminUrl!, { max: 1, onnotice: () => {} })
  await admin.unsafe(`CREATE DATABASE "${name}"`)

  const target = new URL(adminUrl!)
  target.pathname = `/${name}`

  const { db, close } = createDb(target.toString())
  await migrate(db, { migrationsFolder: join(import.meta.dir, '../../drizzle') })

  return {
    db,
    url: target.toString(),
    auth: createAuth(db),
    close,
    drop: async () => {
      await close()
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      await admin.end()
    },
  }
}

export async function createUser(
  ctx: TestContext,
  input: {
    name?: string
    role?: 'captain' | 'member'
    status?: 'pending' | 'active' | 'disabled'
    discordId?: string
  } = {},
): Promise<string> {
  const id = crypto.randomUUID()
  const now = new Date()
  await ctx.db.insert(user).values({
    id,
    name: input.name ?? `User ${id.slice(0, 4)}`,
    email: `${id}@test.local`,
    emailVerified: false,
    image: null,
    createdAt: now,
    updatedAt: now,
    role: input.role ?? 'member',
    status: input.status ?? 'pending',
  })

  if (input.discordId) {
    await ctx.db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: input.discordId,
      providerId: 'discord',
      userId: id,
      createdAt: now,
      updatedAt: now,
    })
  }

  return id
}

/**
 * Inserts a session row and builds the cookie better-auth expects.
 * Signature = HMAC-SHA256(secret, token) base64, exactly like better-auth's signCookieValue.
 */
export async function createSessionCookie(ctx: TestContext, userId: string): Promise<string> {
  const token = crypto.randomUUID().replace(/-/g, '')
  const now = new Date()
  await ctx.db.insert(session).values({
    id: crypto.randomUUID(),
    token,
    expiresAt: new Date(now.getTime() + 86_400_000),
    createdAt: now,
    updatedAt: now,
    ipAddress: null,
    userAgent: 'bun-test',
    userId,
  })

  const signature = createHmac('sha256', env.secret).update(token).digest('base64')
  return `better-auth.session_token=${token}.${encodeURIComponent(signature)}`
}

export type TestServer = {
  call: (
    path: string,
    options?: { method?: string; body?: unknown; cookie?: string },
  ) => Promise<Response>
  port: number
  close: () => void
}

/**
 * Real HTTP on an ephemeral port. `app.handle(request)` does not route in this Elysia build
 * (routes only serve once listening), so tests go over the socket like a browser would.
 */
export function createTestApp(ctx: TestContext, spaDist?: string): TestServer {
  const app = createApp({ db: ctx.db, auth: ctx.auth, spaDist })
  app.listen(0)

  const port = (app.server as { port?: number } | undefined)?.port
  if (!port) throw new Error('test server did not start')

  return {
    port,
    close: () => app.stop(),
    call: async (path, options = {}) => {
      const headers = new Headers()
      if (options.cookie) headers.set('cookie', options.cookie)
      if (options.body !== undefined) headers.set('content-type', 'application/json')

      return fetch(`http://127.0.0.1:${port}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      })
    },
  }
}
