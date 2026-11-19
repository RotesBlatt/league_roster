import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { teams } from '../../src/db/schema.ts'
import { createTeam, createTestContext, createUser, type TestContext } from './helpers.ts'

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
    const tagged = await createTeam(ctx, { createdBy: creator, shortName: 'DBW' })
    const untagged = await createTeam(ctx, { createdBy: creator })

    const [withShort] = await ctx.db.select().from(teams).where(eq(teams.id, tagged))
    const [without] = await ctx.db.select().from(teams).where(eq(teams.id, untagged))

    expect(withShort?.shortName).toBe('DBW')
    expect(without?.shortName).toBeNull()
  })
})
