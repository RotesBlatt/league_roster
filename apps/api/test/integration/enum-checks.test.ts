import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import {
  addMembership,
  createTestContext,
  createUser,
  seedTeam,
  type TestContext,
} from './helpers.ts'

/**
 * `CHECK`s generated from the shared enums (quick-wins.md D1). The TS union and Elysia's
 * validation already refuse these values — but a raw SQL statement, a migration or a psql session
 * does not go through either. The database is the last line, so it is the one under test here.
 *
 * Raw `db.execute` on purpose: drizzle's insert would refuse `'admiral'` at *compile* time, which
 * would prove the types work, not that the constraint does.
 */
let ctx: TestContext
let teamId: string
let userId: string

beforeAll(async () => {
  ctx = await createTestContext()
  userId = await createUser(ctx, { name: 'Constraint Owner' })
  teamId = await seedTeam(ctx, { createdBy: userId })

  await ctx.db.execute(sql`
    insert into profile ("id", "userId", "displayName", "preferredRole", "updatedAt")
    values (${crypto.randomUUID()}, ${userId}, 'Constraint Owner', 'MID', now())
  `)
  await ctx.db.execute(sql`
    insert into riot_account ("id", "userId", "gameName", "tagLine", "puuid", "createdAt")
    values (${crypto.randomUUID()}, ${userId}, 'Owner#EUW', 'EUW1', ${crypto.randomUUID()}, now())
  `)
})

afterAll(async () => {
  await ctx.drop()
})

/** Postgres' code, wherever the driver put it — drizzle keeps the pg error on `cause`. */
function pgCode(error: unknown): string | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string') return code
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}

/**
 * Asserts the *database* refused the value, and refused it as a CHECK violation (23514) — not as a
 * syntax error or a missing column, which a typo in the test would also produce.
 */
async function expectCheckViolation(run: PromiseLike<unknown>): Promise<void> {
  let code: string | undefined
  try {
    await run
  } catch (error) {
    code = pgCode(error)
  }
  expect(code).toBe('23514')
}

/**
 * One membership per person: `(teamId, userId)` is UNIQUE, so every attempt needs its own member —
 * otherwise a test row collides (23505) before the constraint under test ever runs.
 */
async function insertMembership(role: string, status = 'active'): Promise<void> {
  const memberId = await createUser(ctx)
  await ctx.db.execute(sql`
    insert into membership ("id", "teamId", "userId", "role", "status", "joinedAt", "updatedAt")
    values (${crypto.randomUUID()}, ${teamId}, ${memberId}, ${role}, ${status}, now(), now())
  `)
}

describe('the enum columns are constrained in the database', () => {
  test('the values the app writes are accepted', async () => {
    // the control: a constraint that rejects everything would pass every test below
    await insertMembership('captain')
    await insertMembership('member', 'disabled')
  })

  test('membership.role rejects a value outside USER_ROLES', async () => {
    const memberId = await createUser(ctx)
    await expectCheckViolation(
      ctx.db.execute(sql`
        insert into membership ("id", "teamId", "userId", "role", "status", "joinedAt", "updatedAt")
        values (${crypto.randomUUID()}, ${teamId}, ${memberId}, 'admiral', 'active', now(), now())
      `),
    )
  })

  test('membership.status rejects a value outside MEMBER_STATUSES', async () => {
    const memberId = await createUser(ctx)
    await expectCheckViolation(
      ctx.db.execute(sql`
        insert into membership ("id", "teamId", "userId", "role", "status", "joinedAt", "updatedAt")
        values (${crypto.randomUUID()}, ${teamId}, ${memberId}, 'member', 'paused', now(), now())
      `),
    )
  })

  test('profile.preferredRole rejects a value outside ROLES', async () => {
    await expectCheckViolation(
      ctx.db.execute(sql`
        update profile set "preferredRole" = 'JUNGLE' where "userId" = ${userId}
      `),
    )
  })

  test('riot_account tier and division reject values outside TIERS / DIVISIONS', async () => {
    await expectCheckViolation(
      ctx.db.execute(sql`
        update riot_account set "soloTier" = 'WOOD' where "userId" = ${userId}
      `),
    )
    await expectCheckViolation(
      ctx.db.execute(sql`
        update riot_account set "flexDivision" = 'V' where "userId" = ${userId}
      `),
    )
  })

  test('roster_entry.roleOverride rejects a value outside ROLES', async () => {
    // the entry has to exist first: a check on a column of a missing row proves nothing
    const entryId = crypto.randomUUID()
    const entryOwner = await createUser(ctx)
    await addMembership(ctx, { teamId, userId: entryOwner })
    await ctx.db.execute(sql`
      insert into roster_entry ("id", "teamId", "userId", "isActive", "createdAt", "updatedAt")
      values (${entryId}, ${teamId}, ${entryOwner}, true, now(), now())
    `)

    await expectCheckViolation(
      ctx.db.execute(sql`
        update roster_entry set "roleOverride" = 'FILL' where "id" = ${entryId}
      `),
    )
    // and the nullable column still takes NULL — a CHECK must not be "NOT NULL" in disguise
    await ctx.db.execute(sql`
      update roster_entry set "roleOverride" = null where "id" = ${entryId}
    `)
  })
})
