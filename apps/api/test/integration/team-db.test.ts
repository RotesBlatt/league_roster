import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { invites, memberships, user } from '../../src/db/schema.ts'
import { forTeam } from '../../src/lib/team-db.ts'
import { getTeamBySlug } from '../../src/lib/teams.ts'
import {
  addMembership,
  createTestContext,
  createUser,
  seedTeam,
  type TestContext,
} from './helpers.ts'

/**
 * The point of `forTeam` (multi-team.md §5): a route cannot reach another team's rows, not
 * because it remembered a `WHERE`, but because the only handle it gets cannot express one.
 *
 * The sample team-scoped table is `invite`: `player` used to play this role and has been dropped,
 * and `invite` has a `teamId` with no dependency on a membership, which keeps this file about the
 * scope and nothing else.
 */
let ctx: TestContext
let alphaId: string
let bravoId: string
let bravoInviteId: string
let ownerId: string

beforeAll(async () => {
  ctx = await createTestContext()
  ownerId = await createUser(ctx, { name: 'Owner' })
  alphaId = await seedTeam(ctx, { createdBy: ownerId, slug: 'alpha', name: 'Alpha' })
  bravoId = await seedTeam(ctx, { createdBy: ownerId, slug: 'bravo', name: 'Bravo' })

  const [bravoInvite] = await ctx.db
    .insert(invites)
    .values({
      id: crypto.randomUUID(),
      teamId: bravoId,
      code: 'bravo-only',
      note: 'bravo only',
      createdBy: ownerId,
      createdAt: new Date(),
    })
    .returning()

  bravoInviteId = bravoInvite!.id
})

afterAll(async () => {
  await ctx.drop()
})

async function alphaScope() {
  const team = await getTeamBySlug(ctx.db, 'alpha')
  if (!team) throw new Error('alpha team missing')
  return forTeam(ctx.db, team)
}

const inviteValues = (code: string) => ({
  id: crypto.randomUUID(),
  code,
  note: null,
  createdBy: ownerId,
  createdAt: new Date(),
})

describe('forTeam', () => {
  test('inserts a row into its own team without being told the team', async () => {
    const scope = await alphaScope()

    // note: no teamId in the values — the type does not allow one
    const row = await scope.insertInto(invites, inviteValues('alpha-inserted'))

    expect(row?.teamId).toBe(alphaId)
  })

  test('reads only its own team’s rows', async () => {
    const scope = await alphaScope()

    const rows = await scope.selectFrom(invites)
    expect(rows.every((row) => row.teamId === alphaId)).toBe(true)

    // the same query, narrowed to another team's id, still finds nothing
    expect(await scope.selectFrom(invites, eq(invites.id, bravoInviteId))).toEqual([])
  })

  test('cannot update another team’s row', async () => {
    const scope = await alphaScope()

    const updated = await scope.update(invites, { note: 'stolen' }, eq(invites.id, bravoInviteId))
    expect(updated).toEqual([])

    const [row] = await ctx.db.select().from(invites).where(eq(invites.id, bravoInviteId))
    expect(row?.note).toBe('bravo only')
  })

  test('cannot delete another team’s row', async () => {
    const scope = await alphaScope()

    expect(await scope.deleteFrom(invites, eq(invites.id, bravoInviteId))).toEqual([])

    const [row] = await ctx.db.select().from(invites).where(eq(invites.id, bravoInviteId))
    expect(row?.id).toBe(bravoInviteId)
  })

  test('refuses a teamId in the payload at compile time', async () => {
    const scope = await alphaScope()

    await scope.insertInto(invites, {
      ...inviteValues('smuggled'),
      // @ts-expect-error teamId is injected by the scope, so passing one must not compile
      teamId: bravoId,
    })

    // types are erased at runtime, so prove the real guarantee: the scope overwrites teamId
    const bravoRows = await ctx.db.select().from(invites).where(eq(invites.teamId, bravoId))
    expect(bravoRows.map((row) => row.code)).not.toContain('smuggled')

    const alphaRows = await ctx.db.select().from(invites).where(eq(invites.teamId, alphaId))
    expect(alphaRows.find((row) => row.code === 'smuggled')?.teamId).toBe(alphaId)
  })

  // the pair invites.ts and members.ts need: a team table joined to a global one (`user`)
  test('joins a global table and still reads only its own team', async () => {
    const scope = await alphaScope()
    const alphaCaptain = await createUser(ctx, { name: 'Alpha Captain' })
    const bravoCaptain = await createUser(ctx, { name: 'Bravo Captain' })
    await addMembership(ctx, { teamId: alphaId, userId: alphaCaptain, role: 'captain' })
    await addMembership(ctx, { teamId: bravoId, userId: bravoCaptain, role: 'captain' })

    const rows = await scope.joinFrom(
      memberships,
      user,
      eq(memberships.userId, user.id),
      { name: user.name, role: memberships.role },
      { kind: 'inner', orderBy: [user.name] },
    )

    expect(rows.map((row) => row.name)).toContain('Alpha Captain')
    expect(rows.map((row) => row.name)).not.toContain('Bravo Captain')
  })

  test('orders what it returns when asked', async () => {
    const scope = await alphaScope()
    await scope.insertInto(invites, inviteValues('alpha-support'))

    const rows = await scope.selectFrom(invites, undefined, { orderBy: [invites.code] })
    // only this test's rows: sibling tests share the alpha team
    const codes = rows.map((row) => row.code).filter((code) => code.startsWith('alpha-'))
    expect(codes).toEqual(['alpha-inserted', 'alpha-support'])
  })
})
