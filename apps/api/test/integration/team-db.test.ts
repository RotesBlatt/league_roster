import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { memberships, players, user } from '../../src/db/schema.ts'
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
 */
let ctx: TestContext
let alphaId: string
let bravoId: string
let bravoPlayerId: string

beforeAll(async () => {
  ctx = await createTestContext()
  const owner = await createUser(ctx, { name: 'Owner' })
  alphaId = await seedTeam(ctx, { createdBy: owner, slug: 'alpha', name: 'Alpha' })
  bravoId = await seedTeam(ctx, { createdBy: owner, slug: 'bravo', name: 'Bravo' })

  const now = new Date()
  const [bravoPlayer] = await ctx.db
    .insert(players)
    .values({
      id: crypto.randomUUID(),
      teamId: bravoId,
      displayName: 'Bravo mid',
      role: 'MID',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  bravoPlayerId = bravoPlayer!.id
})

afterAll(async () => {
  await ctx.drop()
})

async function alphaScope() {
  const team = await getTeamBySlug(ctx.db, 'alpha')
  if (!team) throw new Error('alpha team missing')
  return forTeam(ctx.db, team)
}

describe('forTeam', () => {
  test('inserts a row into its own team without being told the team', async () => {
    const scope = await alphaScope()

    // note: no teamId in the values — the type does not allow one
    const row = await scope.insertInto(players, {
      id: crypto.randomUUID(),
      displayName: 'Alpha top',
      role: 'TOP',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    expect(row?.teamId).toBe(alphaId)
  })

  test('reads only its own team’s rows', async () => {
    const scope = await alphaScope()
    const rows = await scope.selectFrom(players)

    expect(rows.map((row) => row.displayName)).toEqual(['Alpha top'])
  })

  test('cannot read another team’s row even when asked for its id', async () => {
    const scope = await alphaScope()

    expect(await scope.selectFrom(players, eq(players.id, bravoPlayerId))).toEqual([])
  })

  test('cannot update another team’s row', async () => {
    const scope = await alphaScope()

    const updated = await scope.update(players, { note: 'stolen' }, eq(players.id, bravoPlayerId))
    expect(updated).toEqual([])

    const untouched = await scope.selectFrom(players, eq(players.id, bravoPlayerId))
    expect(untouched).toEqual([])
    // and really untouched, checked without the scope
    const [row] = await ctx.db.select().from(players).where(eq(players.id, bravoPlayerId))
    expect(row?.note).toBeNull()
  })

  test('cannot delete another team’s row', async () => {
    const scope = await alphaScope()

    expect(await scope.deleteFrom(players, eq(players.id, bravoPlayerId))).toEqual([])

    const [row] = await ctx.db.select().from(players).where(eq(players.id, bravoPlayerId))
    expect(row?.id).toBe(bravoPlayerId)
  })

  test('refuses a teamId in the payload at compile time', async () => {
    const scope = await alphaScope()

    await scope.insertInto(players, {
      id: crypto.randomUUID(),
      // @ts-expect-error teamId is injected by the scope, so passing one must not compile
      teamId: bravoId,
      displayName: 'Smuggled',
      role: 'MID',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // types are erased at runtime, so prove the real guarantee: the scope overwrites teamId
    const bravoRows = await ctx.db.select().from(players).where(eq(players.teamId, bravoId))
    expect(bravoRows.map((row) => row.displayName)).not.toContain('Smuggled')

    const alphaRows = await ctx.db.select().from(players).where(eq(players.teamId, alphaId))
    expect(alphaRows.find((row) => row.displayName === 'Smuggled')?.teamId).toBe(alphaId)
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
    await scope.insertInto(players, {
      id: crypto.randomUUID(),
      displayName: 'Alpha support',
      role: 'SUP',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const rows = await scope.selectFrom(players, undefined, { orderBy: [players.displayName] })
    // only this test's rows: sibling tests share the alpha team
    const names = rows.map((row) => row.displayName).filter((name) => name.startsWith('Alpha'))
    expect(names).toEqual(['Alpha support', 'Alpha top'])
  })
})
