import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { user } from '../../src/db/schema.ts'
import { ensureAccess, getMe } from '../../src/lib/access.ts'
import { createTestContext, createUser, type TestContext } from './helpers.ts'

let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.drop()
})

describe('ensureAccess', () => {
  test('throws for an unknown user', async () => {
    await expect(ensureAccess(ctx.db, crypto.randomUUID())).rejects.toThrow(/not found/)
  })

  test('first account on an empty install becomes captain', async () => {
    const userId = await createUser(ctx)
    const me = await ensureAccess(ctx.db, userId, [])

    expect(me.role).toBe('captain')
    expect(me.status).toBe('active')

    const row = await ctx.db.select().from(user).where(eq(user.id, userId))
    expect(row[0]?.role).toBe('captain')
  })

  test('a later account stays pending while an active member exists', async () => {
    const userId = await createUser(ctx, { name: 'Late joiner' })
    const me = await ensureAccess(ctx.db, userId, [])

    expect(me.role).toBe('member')
    expect(me.status).toBe('pending')
  })

  test('allowlisted discord id is promoted even when a captain exists', async () => {
    const userId = await createUser(ctx, { discordId: '424242424242424242' })
    const me = await ensureAccess(ctx.db, userId, ['424242424242424242'])

    expect(me).toEqual(expect.objectContaining({ role: 'captain', status: 'active' }))
  })

  test('allowlist matches the discord account, not the local user id', async () => {
    const userId = await createUser(ctx, { discordId: '111111111111111111' })
    const me = await ensureAccess(ctx.db, userId, [userId])

    expect(me.role).toBe('member')
  })

  test('a disabled account is never promoted, even when allowlisted', async () => {
    const userId = await createUser(ctx, { status: 'disabled', discordId: '999999999999999999' })
    const me = await ensureAccess(ctx.db, userId, ['999999999999999999'])

    expect(me.status).toBe('disabled')
    expect(me.role).toBe('member')
  })

  test('an active member is left untouched', async () => {
    const userId = await createUser(ctx, { role: 'member', status: 'active' })
    const me = await ensureAccess(ctx.db, userId, [])

    expect(me).toEqual(expect.objectContaining({ role: 'member', status: 'active' }))
  })
})

describe('getMe', () => {
  test('returns null for a missing user', async () => {
    expect(await getMe(ctx.db, crypto.randomUUID())).toBeNull()
  })

  test('maps the row to the public shape without internal fields', async () => {
    const userId = await createUser(ctx, { name: 'Mapped', status: 'active' })
    const me = await getMe(ctx.db, userId)

    expect(me).toEqual({
      id: userId,
      name: 'Mapped',
      email: `${userId}@test.local`,
      image: null,
      role: 'member',
      status: 'active',
    })
  })
})
