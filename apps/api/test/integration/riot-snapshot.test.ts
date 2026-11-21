import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { riotAccounts } from '../../src/db/schema.ts'
import { createTestContext, createUser, type TestContext } from './helpers.ts'

/**
 * The snapshot columns the Riot client fills (riot-api.md §8): level, icon, and **both** ranks.
 * Nothing reads them yet — this pins the shape that the migration, the client and the profile card
 * will agree on, and it runs against a real database rather than an empty schema.
 *
 * The migration itself is covered by `migrations.test.ts`, which replays every step against a row
 * in every table; there is nothing to add there for nullable columns.
 */
let ctx: TestContext
let userId: string

beforeAll(async () => {
  ctx = await createTestContext()
  userId = await createUser(ctx, { name: 'Julius' })
})

afterAll(async () => {
  await ctx.drop()
})

type AccountValues = typeof riotAccounts.$inferInsert

function insertAccount(values: Partial<AccountValues> = {}) {
  return ctx.db
    .insert(riotAccounts)
    .values({
      id: crypto.randomUUID(),
      userId,
      // one label per row: the per-player unique index is doing its job
      gameName: `Hide on bush ${crypto.randomUUID().slice(0, 6)}`,
      tagLine: 'EUW',
      createdAt: new Date(),
      ...values,
    })
    .returning()
}

describe('the riot_account snapshot columns', () => {
  test('an account that was never checked stores no snapshot at all', async () => {
    const [row] = await insertAccount()

    expect(row?.verifiedAt ?? null).toBeNull()
    expect(row?.fetchedAt ?? null).toBeNull()
    expect(row?.summonerLevel ?? null).toBeNull()
    expect(row?.profileIconId ?? null).toBeNull()
    expect(row?.soloTier ?? null).toBeNull()
    expect(row?.soloDivision ?? null).toBeNull()
    expect(row?.flexTier ?? null).toBeNull()
    expect(row?.flexDivision ?? null).toBeNull()
  })

  test('level, icon and both ranks round-trip', async () => {
    const [row] = await insertAccount({
      summonerLevel: 512,
      profileIconId: 4568,
      soloTier: 'GOLD',
      soloDivision: 'II',
      flexTier: 'SILVER',
      flexDivision: 'IV',
    })

    expect(row?.summonerLevel).toBe(512)
    expect(row?.profileIconId).toBe(4568)
    expect(row?.soloTier).toBe('GOLD')
    expect(row?.soloDivision).toBe('II')
    expect(row?.flexTier).toBe('SILVER')
    expect(row?.flexDivision).toBe('IV')
  })

  test('the two queues are independent — ranked solo, unranked flex is a normal row', async () => {
    const [row] = await insertAccount({
      soloTier: 'DIAMOND',
      soloDivision: 'I',
    })

    expect(row?.soloTier).toBe('DIAMOND')
    expect(row?.flexTier ?? null).toBeNull()
    expect(row?.flexDivision ?? null).toBeNull()
  })
})
