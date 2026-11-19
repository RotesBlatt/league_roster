import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { getMe } from '../../src/lib/access.ts'
import {
  addMembership,
  createTestContext,
  createUser,
  seedTeam,
  type TestContext,
} from './helpers.ts'

/**
 * `getMe` is a read: role/status/team come from the membership row, and no membership means
 * no team. Nothing here grants access — that used to be `ensureAccess`'s bootstrap and
 * allowlist, both retired (multi-team.md §9, §10.4); `fresh-install.test.ts` covers the
 * consequence over HTTP.
 */
let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.drop()
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
