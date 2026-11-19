import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { memberships } from '../../src/db/schema.ts'
import { ensureAccess, getMe } from '../../src/lib/access.ts'
import {
  addMembership,
  createTestContext,
  createUser,
  seedTeam,
  type TestContext,
} from './helpers.ts'

let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.drop()
})

describe('ensureAccess', () => {
  test('throws for an unknown user', async () => {
    const error = await ensureAccess(ctx.db, crypto.randomUUID()).catch((caught) => caught)
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).toMatch(/not found/)
  })

  test('first account on an empty install becomes captain of a new team', async () => {
    const userId = await createUser(ctx)
    const me = await ensureAccess(ctx.db, userId, [])

    expect(me.role).toBe('captain')
    expect(me.status).toBe('active')
    expect(me.teamSlug).toBe('default')

    const row = await ctx.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.teamId, me.teamId!)))
    expect(row[0]?.role).toBe('captain')
    expect(row[0]?.status).toBe('active')
  })

  test('a later account has no team, and no status at all', async () => {
    const userId = await createUser(ctx, { name: 'Late joiner' })
    const me = await ensureAccess(ctx.db, userId, [])

    expect(me.role).toBe('member')
    // null, not 'pending': a person without a membership is not a member
    expect(me.status).toBeNull()
    expect(me.teamId).toBeNull()
    expect(me.teamSlug).toBeNull()
  })

  test('allowlisted discord id is promoted even when a captain exists', async () => {
    const userId = await createUser(ctx, { discordId: '424242424242424242' })
    const me = await ensureAccess(ctx.db, userId, ['424242424242424242'])

    expect(me).toEqual(expect.objectContaining({ role: 'captain', status: 'active' }))
    expect(me.teamSlug).not.toBeNull()
  })

  test('allowlist matches the discord account, not the local user id', async () => {
    const userId = await createUser(ctx, { discordId: '111111111111111111' })
    const me = await ensureAccess(ctx.db, userId, [userId])

    expect(me.role).toBe('member')
    expect(me.status).toBeNull()
  })

  test('a disabled membership is never promoted, even when allowlisted', async () => {
    const userId = await createUser(ctx, { name: 'Disabled', discordId: '999999999999999999' })
    const teamId = await seedTeam(ctx, { createdBy: userId })
    await addMembership(ctx, { teamId, userId, role: 'member', status: 'disabled' })

    const me = await ensureAccess(ctx.db, userId, ['999999999999999999'])

    expect(me.status).toBe('disabled')
    expect(me.role).toBe('member')
  })

  test('an active member is left untouched', async () => {
    const userId = await createUser(ctx, { name: 'Active member' })
    const teamId = await seedTeam(ctx, { createdBy: userId })
    await addMembership(ctx, { teamId, userId, role: 'member', status: 'active' })

    const me = await ensureAccess(ctx.db, userId, [])

    expect(me).toEqual(expect.objectContaining({ role: 'member', status: 'active' }))
  })
})

describe('getMe', () => {
  test('returns null for a missing user', async () => {
    expect(await getMe(ctx.db, crypto.randomUUID())).toBeNull()
  })

  test('maps identity from user and role/status/team from membership', async () => {
    const userId = await createUser(ctx, { name: 'Mapped' })
    const teamId = await seedTeam(ctx, { createdBy: userId, slug: 'mapped' })
    await addMembership(ctx, { teamId, userId, role: 'member', status: 'active' })

    const me = await getMe(ctx.db, userId)

    expect(me).toEqual({
      id: userId,
      name: 'Mapped',
      email: `${userId}@test.local`,
      image: null,
      teamId,
      teamSlug: 'mapped',
      role: 'member',
      status: 'active',
    })
  })

  test('a user without a membership is team-less and status-less', async () => {
    const userId = await createUser(ctx, { name: 'No team' })

    expect(await getMe(ctx.db, userId)).toEqual(
      expect.objectContaining({ teamId: null, teamSlug: null, role: 'member', status: null }),
    )
  })
})
