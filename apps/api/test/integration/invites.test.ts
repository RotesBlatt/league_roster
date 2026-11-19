import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { invites, memberships } from '../../src/db/schema.ts'
import { claimInvite } from '../../src/lib/invites.ts'
import {
  addMembership,
  createTeam,
  createTestContext,
  createUser,
  type TestContext,
} from './helpers.ts'

let ctx: TestContext
let creatorId: string
let teamId: string

beforeAll(async () => {
  ctx = await createTestContext()
  creatorId = await createUser(ctx, { name: 'Creator' })
  teamId = await createTeam(ctx, { createdBy: creatorId })
  await addMembership(ctx, { teamId, userId: creatorId, role: 'captain', status: 'active' })
})

afterEach(async () => {
  await ctx.db.delete(invites)
})

afterAll(async () => {
  await ctx.drop()
})

async function createInvite(
  input: {
    code?: string
    maxUses?: number
    expiresAt?: Date | null
    revokedAt?: Date | null
    inTeam?: string
  } = {},
) {
  const [row] = await ctx.db
    .insert(invites)
    .values({
      id: crypto.randomUUID(),
      code: input.code ?? `code${Math.random().toString(36).slice(2, 8)}`,
      note: null,
      createdBy: creatorId,
      teamId: input.inTeam ?? teamId,
      maxUses: input.maxUses ?? 1,
      uses: 0,
      expiresAt: input.expiresAt ?? null,
      revokedAt: input.revokedAt ?? null,
      createdAt: new Date(),
    })
    .returning()
  if (!row) throw new Error('invite insert failed')
  return row
}

describe('claimInvite', () => {
  test('unknown code is a 404', async () => {
    const userId = await createUser(ctx)
    expect(await claimInvite(ctx.db, { userId, code: 'nope' })).toEqual({
      ok: false,
      status: 404,
      message: 'Invite not found',
    })
  })

  test('revoked invite is a 410', async () => {
    const invite = await createInvite({ revokedAt: new Date() })
    const userId = await createUser(ctx)

    expect(await claimInvite(ctx.db, { userId, code: invite.code })).toEqual({
      ok: false,
      status: 410,
      message: 'This invite was revoked',
    })
  })

  test('expired invite is a 410', async () => {
    const invite = await createInvite({ expiresAt: new Date(Date.now() - 1000) })
    const userId = await createUser(ctx)

    expect(await claimInvite(ctx.db, { userId, code: invite.code })).toEqual({
      ok: false,
      status: 410,
      message: 'This invite expired',
    })
  })

  test('used-up invite is a 410', async () => {
    const invite = await createInvite({ maxUses: 1 })
    await ctx.db.update(invites).set({ uses: 1 }).where(eq(invites.id, invite.id))
    const userId = await createUser(ctx)

    expect(await claimInvite(ctx.db, { userId, code: invite.code })).toEqual({
      ok: false,
      status: 410,
      message: 'This invite is used up',
    })
  })

  test('a valid invite joins *the invite’s* team and burns one use', async () => {
    const invite = await createInvite({ maxUses: 2 })
    const userId = await createUser(ctx)

    expect(await claimInvite(ctx.db, { userId, code: invite.code })).toEqual({
      ok: true,
      inviteId: invite.id,
    })

    const [after] = await ctx.db.select().from(invites).where(eq(invites.id, invite.id))
    expect(after?.uses).toBe(1)

    const [claimed] = await ctx.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.teamId, teamId)))
    expect(claimed?.status).toBe('active')
    expect(claimed?.role).toBe('member')
  })

  test('a captain keeps their role when joining a second team', async () => {
    const otherTeam = await createTeam(ctx, { createdBy: creatorId, slug: 'second' })
    const invite = await createInvite({ maxUses: 1, inTeam: otherTeam })

    await claimInvite(ctx.db, { userId: creatorId, code: invite.code })

    const [own] = await ctx.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, creatorId), eq(memberships.teamId, teamId)))
    const [joined] = await ctx.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, creatorId), eq(memberships.teamId, otherTeam)))
    expect(own?.role).toBe('captain')
    expect(joined?.role).toBe('member')
  })

  test('the same code works up to maxUses, then stops', async () => {
    const invite = await createInvite({ maxUses: 2 })
    const first = await createUser(ctx)
    const second = await createUser(ctx)
    const third = await createUser(ctx)

    expect((await claimInvite(ctx.db, { userId: first, code: invite.code })).ok).toBe(true)
    expect((await claimInvite(ctx.db, { userId: second, code: invite.code })).ok).toBe(true)
    expect(await claimInvite(ctx.db, { userId: third, code: invite.code })).toMatchObject({
      ok: false,
      status: 410,
    })
  })
})
