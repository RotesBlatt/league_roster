import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { count } from 'drizzle-orm'
import { teams } from '../../src/db/schema.ts'
import {
  createSessionCookie,
  createTestApp,
  createTestContext,
  createUser,
  type TestContext,
  type TestServer,
} from './helpers.ts'

/**
 * The retired bootstrap (multi-team.md §10.4): the first account to sign in used to become
 * captain of an invented `default` team. Now creating a team is the only way to be in one
 * (`POST /api/teams`), and an invite link is the only other way in — showing up grants nothing.
 */
let ctx: TestContext
let server: TestServer

beforeAll(async () => {
  ctx = await createTestContext()
  server = createTestApp(ctx)
})

afterAll(async () => {
  server.close()
  await ctx.drop()
})

describe('a fresh install', () => {
  test('gives the first account that signs in no team at all', async () => {
    const user = await createUser(ctx)
    const cookie = await createSessionCookie(ctx, user)

    const me = (await (await server.call('/api/me', { cookie })).json()) as {
      teamSlug: string | null
      status: string | null
      role: string
    }
    expect(me).toMatchObject({ teamSlug: null, status: null, role: 'member' })

    // and no team was invented on the way in
    const [row] = await ctx.db.select({ value: count() }).from(teams)
    expect(row?.value).toBe(0)
  })

  test('...and can then create the one it wants, under its own slug', async () => {
    const user = await createUser(ctx)
    const cookie = await createSessionCookie(ctx, user)

    const res = await server.call('/api/teams', {
      cookie,
      method: 'POST',
      body: { name: 'Erstes Team' },
    })
    expect(res.status).toBe(200)
    expect((await res.json()) as { teamSlug: string }).toMatchObject({ teamSlug: 'erstes-team' })

    const [row] = await ctx.db.select({ value: count() }).from(teams)
    expect(row?.value).toBe(1)
  })
})
