import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { createTestContext, createUser, type TestContext } from './helpers.ts'

/**
 * The pool's schema, as the database itself enforces it (champion-pools.md §4, §5, §6).
 *
 * The one thing worth a dedicated test is the **deferred** position constraint: drizzle cannot
 * express `DEFERRABLE INITIALLY DEFERRED`, so migration 0016 is hand-edited. A regenerate that
 * quietly drops the qualifier would still pass every route test — until someone reorders with a
 * row-by-row write, which is exactly what a future implementation will do.
 *
 * Raw SQL on purpose: a drizzle insert would refuse a duplicate at *compile* time, which proves the
 * types work, not that the constraint does.
 */
let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.drop()
})

function pgCode(error: unknown): string | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string') return code
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}

/** A fresh player with a pool header row and one `main` entry per champion id, in the given order. */
async function seedPool(championIds: number[]): Promise<string> {
  const ownerId = await createUser(ctx)
  await ctx.db.execute(sql`
    insert into pool ("ownerId", "version", "updatedAt") values (${ownerId}, 0, now())
  `)
  for (const [position, championId] of championIds.entries()) {
    await ctx.db.execute(sql`
      insert into pool_entry
        ("id", "ownerId", "kind", "championId", "position", "createdAt", "updatedAt")
      values (${crypto.randomUUID()}, ${ownerId}, 'main', ${championId}, ${position}, now(), now())
    `)
  }
  return ownerId
}

const positionsOf = async (ownerId: string) => {
  const rows = await ctx.db.execute<{ championId: number; position: number }>(sql`
    select "championId", "position" from pool_entry
    where "ownerId" = ${ownerId} order by "position"
  `)
  return rows.map((row) => [row.championId, row.position] as const)
}

describe('pool_entry ordering', () => {
  test('a reorder forward may pass through a duplicate position', async () => {
    // [1,2] -> [2,1]: entry 1 wants position 0 while entry 2 still holds it
    const ownerId = await seedPool([1, 2])

    await ctx.db.transaction(async (tx) => {
      // 1 wants position 1 while 2 still holds it, so mid-transaction there are two rows at 1
      await tx.execute(
        sql`update pool_entry set "position" = 1 where "ownerId" = ${ownerId} and "championId" = 1`,
      )
      await tx.execute(
        sql`update pool_entry set "position" = 0 where "ownerId" = ${ownerId} and "championId" = 2`,
      )
    })

    expect(await positionsOf(ownerId)).toEqual([
      [2, 0],
      [1, 1],
    ])
  })

  test('a reorder backward may pass through a duplicate position too', async () => {
    // [1,2,3] -> [3,1,2]: 3 jumps to 1 while 2 still holds it
    const ownerId = await seedPool([1, 2, 3])

    await ctx.db.transaction(async (tx) => {
      await tx.execute(
        sql`update pool_entry set "position" = 1 where "ownerId" = ${ownerId} and "championId" = 3`,
      )
      await tx.execute(
        sql`update pool_entry set "position" = 2 where "ownerId" = ${ownerId} and "championId" = 2`,
      )
    })

    expect(await positionsOf(ownerId)).toEqual([
      [1, 0],
      [3, 1],
      [2, 2],
    ])
  })

  test('a duplicate position that survives the commit is still refused', async () => {
    const ownerId = await seedPool([1, 2])

    let code: string | undefined
    try {
      await ctx.db.transaction(async (tx) => {
        await tx.execute(
          sql`update pool_entry set "position" = 0 where "ownerId" = ${ownerId} and "championId" = 2`,
        )
      })
    } catch (error) {
      code = pgCode(error)
    }

    expect(code).toBe('23505')
    expect(await positionsOf(ownerId)).toEqual([
      [1, 0],
      [2, 1],
    ])
  })

  test('a negative position is refused', async () => {
    const ownerId = await seedPool([1])

    let code: string | undefined
    try {
      await ctx.db.execute(sql`update pool_entry set "position" = -1 where "ownerId" = ${ownerId}`)
    } catch (error) {
      code = pgCode(error)
    }

    expect(code).toBe('23514')
  })
})

describe('pool_entry vocabulary', () => {
  test('the three kinds are accepted', async () => {
    const ownerId = await seedPool([])

    for (const [index, kind] of ['main', 'situational', 'blind'].entries()) {
      await ctx.db.execute(sql`
        insert into pool_entry
          ("id", "ownerId", "kind", "championId", "position", "createdAt", "updatedAt")
        values (${crypto.randomUUID()}, ${ownerId}, ${kind}, ${index + 1}, 0, now(), now())
      `)
    }
  })

  test('a fourth kind is refused by the database, not just by the types', async () => {
    const ownerId = await seedPool([])

    let code: string | undefined
    try {
      await ctx.db.execute(sql`
        insert into pool_entry
          ("id", "ownerId", "kind", "championId", "position", "createdAt", "updatedAt")
        values (${crypto.randomUUID()}, ${ownerId}, 'extra', 1, 0, now(), now())
      `)
    } catch (error) {
      code = pgCode(error)
    }

    expect(code).toBe('23514')
  })

  test('the same champion twice in one list is refused', async () => {
    const ownerId = await seedPool([7])

    let code: string | undefined
    try {
      await ctx.db.execute(sql`
        insert into pool_entry
          ("id", "ownerId", "kind", "championId", "position", "createdAt", "updatedAt")
        values (${crypto.randomUUID()}, ${ownerId}, 'main', 7, 5, now(), now())
      `)
    } catch (error) {
      code = pgCode(error)
    }

    expect(code).toBe('23505')
  })

  test('the same champion in main and in blind is allowed', async () => {
    const ownerId = await seedPool([7])

    await ctx.db.execute(sql`
      insert into pool_entry
        ("id", "ownerId", "kind", "championId", "position", "createdAt", "updatedAt")
      values (${crypto.randomUUID()}, ${ownerId}, 'blind', 7, 0, now(), now())
    `)

    const rows = await ctx.db.execute<{ count: string }>(sql`
      select count(*)::text as count from pool_entry where "ownerId" = ${ownerId} and "championId" = 7
    `)
    expect(rows[0]?.count).toBe('2')
  })
})

describe('pool ownership', () => {
  test('an entry needs a pool header row', async () => {
    const strangerId = await createUser(ctx)

    let code: string | undefined
    try {
      await ctx.db.execute(sql`
        insert into pool_entry
          ("id", "ownerId", "kind", "championId", "position", "createdAt", "updatedAt")
        values (${crypto.randomUUID()}, ${strangerId}, 'main', 1, 0, now(), now())
      `)
    } catch (error) {
      code = pgCode(error)
    }

    expect(code).toBe('23503')
  })

  test('deleting the player takes the pool and its entries with it', async () => {
    const ownerId = await seedPool([1, 2, 3])

    await ctx.db.execute(sql`delete from "user" where "id" = ${ownerId}`)

    const pools = await ctx.db.execute<{ count: string }>(sql`
      select count(*)::text as count from pool where "ownerId" = ${ownerId}
    `)
    const entries = await ctx.db.execute<{ count: string }>(sql`
      select count(*)::text as count from pool_entry where "ownerId" = ${ownerId}
    `)
    expect(pools[0]?.count).toBe('0')
    expect(entries[0]?.count).toBe('0')
  })
})
