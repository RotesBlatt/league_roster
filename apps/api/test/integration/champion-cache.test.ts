import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { desc, eq, inArray } from 'drizzle-orm'
import { championPatches, champions } from '../../src/db/schema.ts'
import { createTestContext, type TestContext } from './helpers.ts'

/**
 * The champion cache keeps **two patches**, and the pair `(patch, championId)` is what makes that
 * possible (hexserve-champion-data.md §4): when a patch day moves the dump on, tonight's games were
 * played on yesterday's patch, and both labels have to be storable at once. A single-column primary
 * key on `championId` would look right against an empty database and delete half the cache on the
 * first refresh.
 *
 * `champion_patch` is the per-patch half of the same cache: what the dump said about the patch
 * (`lastUpdate` = when it was published, `timestamp` = the only ordering key retention may use)
 * and when we pulled its champion list. Those are facts about the patch, so they are stored once,
 * not 173 times on the label rows.
 *
 * Storing rows is tested here rather than through a route: the tables are the rule.
 */
let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.drop()
})

/** A patch as `version.json` described it. */
function patch(overrides: Partial<typeof championPatches.$inferInsert> = {}) {
  return {
    patch: '16.23.1',
    publishedAt: new Date('2026-11-19T18:40:23.358Z'),
    publishedAtTimestamp: 1795113623,
    fetchedAt: new Date('2026-11-19T18:45:00.000Z'),
    ...overrides,
  }
}

/** One label row as the refresh will write it — the dump's own shape, no invented fields. */
function champion(overrides: Partial<typeof champions.$inferInsert> = {}) {
  return {
    patch: '16.23.1',
    championId: 1,
    name: 'Annie',
    slug: 'annie',
    iconUrl: 'https://raw.communitydragon.org/16.23/v1/champion-icons/1.png',
    positions: ['MIDDLE'],
    roles: ['MAGE', 'BURST'],
    locale: 'en_US',
    ...overrides,
  }
}

/** The pg error code, wherever the driver put it (drizzle wraps it on `cause`). */
function pgCode(error: unknown): string | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string') return code
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}

async function insertPatch(overrides: Partial<typeof championPatches.$inferInsert> = {}) {
  await ctx.db.insert(championPatches).values(patch(overrides))
}

describe('champion_patch', () => {
  test('stores when the dump published the patch and when we fetched its champions', async () => {
    await insertPatch()

    const [row] = await ctx.db
      .select()
      .from(championPatches)
      .where(eq(championPatches.patch, '16.23.1'))

    expect(row?.publishedAt.toISOString()).toBe('2026-11-19T18:40:23.358Z')
    expect(row?.publishedAtTimestamp).toBe(1795113623)
    expect(row?.fetchedAt.toISOString()).toBe('2026-11-19T18:45:00.000Z')
  })

  test('one row per patch: a re-fetch updates it, a second row is refused', async () => {
    let code: string | undefined
    try {
      await insertPatch()
    } catch (error) {
      code = pgCode(error)
    }

    expect(code).toBe('23505')
  })

  /**
   * The column exists so pruning can order without comparing version strings anywhere — the
   * `16.9.1` / `16.10.1` trap from §5 stays in the pure rule, and the database has a key that
   * cannot fall into it.
   */
  test('orders by the dump’s timestamp, where version string order would lie', async () => {
    await ctx.db
      .insert(championPatches)
      .values([
        patch({ patch: '16.9.1', publishedAtTimestamp: 100 }),
        patch({ patch: '16.10.1', publishedAtTimestamp: 200 }),
      ])

    // scoped to the pair, not "the whole table": earlier tests in this file share the database,
    // and a slice of an unscoped result asserts about whichever patches happen to be newest
    const rows = await ctx.db
      .select({ patch: championPatches.patch })
      .from(championPatches)
      .where(inArray(championPatches.patch, ['16.9.1', '16.10.1']))
      .orderBy(desc(championPatches.publishedAtTimestamp))

    expect(rows.map((row) => row.patch)).toEqual(['16.10.1', '16.9.1'])
  })
})

describe('champion', () => {
  test('the same champion in two patches is two rows — the safety net is storable', async () => {
    await insertPatch({ patch: '16.22.1', publishedAtTimestamp: 1794000000 })
    await ctx.db
      .insert(champions)
      .values([champion(), champion({ patch: '16.22.1', name: 'Annie (alt)', roles: [] })])

    const rows = await ctx.db.select().from(champions).where(eq(champions.championId, 1))
    expect(rows.map((row) => row.patch).sort()).toEqual(['16.22.1', '16.23.1'])
  })

  test('one champion per patch: a duplicated replace is refused by the database', async () => {
    let code: string | undefined
    try {
      await ctx.db.insert(champions).values(champion())
    } catch (error) {
      code = pgCode(error)
    }

    // 23505 = unique violation; the composite primary key is what catches it
    expect(code).toBe('23505')
  })

  test('hint lists round-trip in order, and an absent one is an empty list not null', async () => {
    await insertPatch({ patch: '16.24.1', publishedAtTimestamp: 1796000000 })
    await ctx.db
      .insert(champions)
      .values([
        champion({ patch: '16.24.1', championId: 266, name: 'Aatrox', positions: [], roles: [] }),
        champion({ patch: '16.24.1', championId: 2, name: 'Olaf', positions: ['TOP'], roles: [] }),
      ])

    // keyed by id, not by row order: `championId` 2 sorts before 266, and destructuring a
    // "natural" order is how a test starts asserting about the wrong champion
    const byId = new Map(
      (await ctx.db.select().from(champions).where(eq(champions.patch, '16.24.1'))).map((row) => [
        row.championId,
        row,
      ]),
    )

    expect(byId.get(266)?.positions).toEqual([])
    expect(byId.get(266)?.roles).toEqual([])
    expect(byId.get(2)?.positions).toEqual(['TOP'])
  })

  test('the locale we rendered with is stored on the row', async () => {
    const [row] = await ctx.db
      .select()
      .from(champions)
      .where(eq(champions.championId, 266))
      .limit(1)

    expect(row?.locale).toBe('en_US')
  })

  /**
   * A label without its patch is a row nothing can date or prune. The foreign key means the
   * refresh's prune is one statement (delete the patch, its labels follow) and an orphan cannot
   * exist even if a route forgets an order of operations.
   */
  test('a label for a patch we never recorded is refused', async () => {
    let code: string | undefined
    try {
      await ctx.db.insert(champions).values(champion({ patch: '16.99.1' }))
    } catch (error) {
      code = pgCode(error)
    }

    // 23503 = foreign key violation
    expect(code).toBe('23503')
  })
})
