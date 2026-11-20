import { join } from 'node:path'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { createDb, Db } from './index.ts'

/** apps/api/src/db -> apps/api/drizzle */
export const migrationsFolder = join(import.meta.dir, '../../drizzle')

/** One key for every replica of this app: migrations are a single-writer step. */
export const MIGRATION_LOCK_KEY = 727_001

type Client = ReturnType<typeof createDb>['client']

/**
 * Runs `work` while holding a Postgres advisory lock, so two replicas booting at once
 * cannot race on the same schema. The lock is cluster-wide and held on a reserved
 * connection: `work` may use other connections, but nobody else can take the key.
 */
export async function withMigrationLock<T>(client: Client, work: () => Promise<T>): Promise<T> {
  const lock = await client.reserve()
  let acquired = false
  try {
    await lock`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`
    acquired = true
    return await work()
  } finally {
    if (acquired) await lock`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`
    lock.release()
  }
}

export async function runMigrations(db: Db, client: Client): Promise<void> {
  await withMigrationLock(client, () => migrate(db, { migrationsFolder }))
}
