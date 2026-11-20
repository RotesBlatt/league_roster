import { afterAll, beforeAll, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { createDb } from '../../src/db/index.ts'
import {
  MIGRATION_LOCK_KEY,
  migrationsFolder,
  runMigrations,
  withMigrationLock,
} from '../../src/db/migrations.ts'
import { createTestContext, type TestContext } from './helpers.ts'

/**
 * docker-compose can boot two replicas against the same database, and both would run the
 * entrypoint's `migrate`. Two migrators racing on one schema can leave half-applied DDL,
 * so the second waits for the advisory lock instead.
 */
let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext({ migrate: false })
})

afterAll(async () => {
  await ctx.drop()
})

test('a second replica waits for the migration lock instead of running at the same time', async () => {
  const replica = createDb(ctx.url)
  const blocker = await replica.client.reserve()

  try {
    await blocker`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`

    // without the lock this resolves as 'ran' almost immediately
    const outcome = await Promise.race([
      withMigrationLock(replica.client, async () => 'ran'),
      Bun.sleep(100).then(() => 'blocked'),
    ])
    expect(outcome).toBe('blocked')

    await blocker`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`
    expect(await withMigrationLock(replica.client, async () => 'ran')).toBe('ran')
  } finally {
    blocker.release()
    await replica.close()
  }
})

test('the lock releases, and the migrations are applied exactly once', async () => {
  const replica = createDb(ctx.url)
  try {
    await runMigrations(replica.db, replica.client)

    const [applied] = Array.from(
      await replica.db.execute(sql`select count(*)::int as rows from drizzle.__drizzle_migrations`),
    ) as unknown as { rows: number }[]
    expect(applied?.rows).toBe(readMigrationFiles({ migrationsFolder }).length)
  } finally {
    await replica.close()
  }
})
