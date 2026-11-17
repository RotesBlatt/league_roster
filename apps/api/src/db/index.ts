import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../env.ts'
import * as schema from './schema.ts'

export type Db = ReturnType<typeof createDb>['db']

/**
 * No hidden singletons: the app receives a Db, tests build their own.
 * postgres-js connects lazily, so creating this does not require a server.
 */
export function createDb(url: string) {
  const client = postgres(url, { max: 10, idle_timeout: 20, onnotice: () => {} })
  const db = drizzle({ client, schema })
  return { db, client, close: () => client.end({ timeout: 5 }) }
}

const defaultDb = createDb(env.databaseUrl)

export const db = defaultDb.db
export const client = defaultDb.client
export const closeDb = defaultDb.close
export { schema }

/** Better Auth adapter for an arbitrary Db (used by createAuth). */
export const createAuthDatabase = (database: Db) =>
  drizzleAdapter(database, { provider: 'pg', schema })
