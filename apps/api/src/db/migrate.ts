import { join } from 'node:path'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { client, db } from './index.ts'

// apps/api/src/db -> apps/api/drizzle
const migrationsFolder = join(import.meta.dir, '../../drizzle')

await migrate(db, { migrationsFolder })
console.info(`[db] migrations applied from ${migrationsFolder}`)

// the pool would keep the process alive
await client.end()
