import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../env.ts'
import * as schema from './schema.ts'

/** Shared connection pool — one per process (the API is the only writer). */
export const client = postgres(env.databaseUrl, {
  max: 10,
  idle_timeout: 20,
  onnotice: () => {}, // NOTICE spam from migrations is noise
})

export const db = drizzle({ client, schema })
export { schema }

export const authDatabase = drizzleAdapter(db, { provider: 'pg', schema })
