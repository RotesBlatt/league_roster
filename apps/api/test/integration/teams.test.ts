import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { memberships, teams } from '../../src/db/schema.ts'
import { createTeam } from '../../src/lib/teams.ts'
import { createTestContext, createUser, seedTeam, type TestContext } from './helpers.ts'

let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.drop()
})

describe('team schema', () => {
  test('a team carries an optional short name', async () => {
    const creator = await createUser(ctx)
    const tagged = await seedTeam(ctx, { createdBy: creator, shortName: 'DBW' })
    const untagged = await seedTeam(ctx, { createdBy: creator })

    const [withShort] = await ctx.db.select().from(teams).where(eq(teams.id, tagged))
    const [without] = await ctx.db.select().from(teams).where(eq(teams.id, untagged))

    expect(withShort?.shortName).toBe('DBW')
    expect(without?.shortName).toBeNull()
  })
})

describe('createTeam', () => {
  test('creating a team makes the creator its captain, in one transaction', async () => {
    const creator = await createUser(ctx)
    const result = await createTeam(ctx.db, {
      userId: creator,
      name: 'Die Besten',
      shortName: 'DBW',
    })
    if (!result.ok) throw new Error(result.message)

    expect(result.team).toMatchObject({
      name: 'Die Besten',
      shortName: 'DBW',
      slug: 'die-besten',
      createdBy: creator,
    })
    expect(result.membership).toMatchObject({
      teamId: result.team.id,
      userId: creator,
      role: 'captain',
      status: 'active',
    })

    // the rows exist, not just the returned objects
    const [team] = await ctx.db.select().from(teams).where(eq(teams.id, result.team.id))
    const rows = await ctx.db
      .select()
      .from(memberships)
      .where(eq(memberships.teamId, result.team.id))

    expect(team?.slug).toBe('die-besten')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ userId: creator, role: 'captain', status: 'active' })
  })

  test('the slug is derived from the name, umlauts and all', async () => {
    const creator = await createUser(ctx)
    const result = await createTeam(ctx.db, { userId: creator, name: 'Die Löwen' })
    if (!result.ok) throw new Error(result.message)

    expect(result.team.slug).toBe('die-loewen')
  })

  test('a taken slug is a 409, and nothing is written', async () => {
    const owner = await createUser(ctx)
    const latecomer = await createUser(ctx)
    // its own name: other tests in this file already own "Die Besten"
    const first = await createTeam(ctx.db, { userId: owner, name: 'Taken Name' })
    if (!first.ok) throw new Error(first.message)

    // same slug after slugify, different spelling
    const clash = await createTeam(ctx.db, { userId: latecomer, name: 'taken name!' })

    expect(clash).toMatchObject({ ok: false, status: 409 })
    expect(
      await ctx.db.select().from(memberships).where(eq(memberships.userId, latecomer)),
    ).toEqual([])
  })

  test('a name with no usable characters is a 422, and writes nothing', async () => {
    const creator = await createUser(ctx)

    expect(await createTeam(ctx.db, { userId: creator, name: '!!!' })).toMatchObject({
      ok: false,
      status: 422,
    })
    expect(await ctx.db.select().from(memberships).where(eq(memberships.userId, creator))).toEqual(
      [],
    )
  })

  test('a name that slugifies into a reserved word is a 422', async () => {
    const creator = await createUser(ctx)

    expect(await createTeam(ctx.db, { userId: creator, name: 'Admin' })).toMatchObject({
      ok: false,
      status: 422,
    })
  })

  test('the short name stays optional, trimmed, and short', async () => {
    const creator = await createUser(ctx)

    const blank = await createTeam(ctx.db, { userId: creator, name: 'Ohne Tag', shortName: '   ' })
    if (!blank.ok) throw new Error(blank.message)
    expect(blank.team.shortName).toBeNull()

    const padded = await createTeam(ctx.db, {
      userId: creator,
      name: 'Mit Tag',
      shortName: ' DBW ',
    })
    if (!padded.ok) throw new Error(padded.message)
    expect(padded.team.shortName).toBe('DBW')

    const tooLong = await createTeam(ctx.db, {
      userId: creator,
      name: 'Zu lang',
      shortName: 'DBWDBWDBWDBW',
    })
    expect(tooLong).toMatchObject({ ok: false, status: 422 })
  })
})
