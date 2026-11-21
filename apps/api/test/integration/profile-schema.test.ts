import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { profile, riotAccounts, user } from '../../src/db/schema.ts'
import { createTestContext, createUser, type TestContext } from './helpers.ts'

/**
 * The two rules that would rot in route code (player-profiles.md §3): one profile per person,
 * and **at most one main account** — enforced by a partial unique index, not by "we always
 * unset the old one first". A transaction can still get it wrong; the index cannot.
 */
let ctx: TestContext
let userId: string
let otherUserId: string

beforeAll(async () => {
  ctx = await createTestContext()
  userId = await createUser(ctx, { name: 'Julius' })
  otherUserId = await createUser(ctx, { name: 'Someone Else' })
})

afterAll(async () => {
  await ctx.drop()
})

/**
 * Postgres' error code, wherever the driver put it. Drizzle wraps query failures in its own
 * error and keeps the pg one on `cause`, so the code is one hop down (sometimes two).
 */
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
 * Asserts the database refused a write **because a unique rule caught it** (23505), not because
 * the query was malformed. Drizzle returns a thenable rather than a Promise, which bun's
 * `.rejects` will not consume — hence the try/catch.
 */
async function expectUniqueViolation(run: PromiseLike<unknown>): Promise<void> {
  let code: string | undefined
  try {
    await run
  } catch (error) {
    code = pgCode(error)
  }
  expect(code).toBe('23505')
}

function insertProfile(id: string) {
  return ctx.db.insert(profile).values({
    id,
    userId,
    displayName: 'Julius',
    preferredRole: 'MID',
    birthday: '2001-07-14',
    updatedAt: new Date(),
  })
}

function insertAccount(input: {
  userId?: string
  gameName: string
  tagLine?: string
  isMain?: boolean
}) {
  return ctx.db.insert(riotAccounts).values({
    id: crypto.randomUUID(),
    userId: input.userId ?? userId,
    gameName: input.gameName,
    tagLine: input.tagLine ?? 'EUW',
    platform: 'euw1',
    // required since 0010: an account row is always one Riot resolved
    puuid: `puuid-${crypto.randomUUID()}`,
    isMain: input.isMain ?? false,
    createdAt: new Date(),
  })
}

describe('profile table', () => {
  test('a user has at most one profile', async () => {
    await insertProfile(crypto.randomUUID())
    await expectUniqueViolation(insertProfile(crypto.randomUUID()))
  })

  test('a birthday may be left out — declining to share it is a valid choice', async () => {
    const privateUser = await createUser(ctx)
    const [row] = await ctx.db
      .insert(profile)
      .values({
        id: crypto.randomUUID(),
        userId: privateUser,
        displayName: 'Private',
        preferredRole: 'SUP',
        birthday: null,
        updatedAt: new Date(),
      })
      .returning()

    expect(row?.birthday).toBeNull()
  })
})

describe('riot_account table', () => {
  test('a second main account for the same user is refused by the database', async () => {
    await insertAccount({ gameName: 'Main', isMain: true })
    await expectUniqueViolation(insertAccount({ gameName: 'Also Main', isMain: true }))
  })

  test('the main rule is per user — someone else may have their own main', async () => {
    await insertAccount({ userId: otherUserId, gameName: 'Their Main', isMain: true })
  })

  test('any number of non-main accounts is fine', async () => {
    await insertAccount({ gameName: 'Smurf One' })
    await insertAccount({ gameName: 'Smurf Two' })
  })

  test('the same Riot ID cannot be added twice by the same user', async () => {
    await expectUniqueViolation(insertAccount({ gameName: 'Smurf One' }))
  })

  test('the same Riot ID may belong to two different users until one proves ownership', async () => {
    await insertAccount({ userId: otherUserId, gameName: 'Smurf One' })
  })

  test('deleting the user takes the profile and the accounts with it', async () => {
    const doomed = await createUser(ctx)
    await ctx.db.insert(profile).values({
      id: crypto.randomUUID(),
      userId: doomed,
      displayName: 'Doomed',
      preferredRole: 'TOP',
      birthday: '1999-01-01',
      updatedAt: new Date(),
    })
    await insertAccount({ userId: doomed, gameName: 'Doomed Main', isMain: true })

    await ctx.db.delete(user).where(eq(user.id, doomed))

    expect(await ctx.db.select().from(profile).where(eq(profile.userId, doomed))).toHaveLength(0)
    expect(await ctx.db.select().from(riotAccounts).where(eq(riotAccounts.userId, doomed))).toEqual(
      [],
    )
  })
})
