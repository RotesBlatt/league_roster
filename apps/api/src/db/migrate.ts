import { client, closeDb, db } from './index.ts'
import { migrationsFolder, runMigrations } from './migrations.ts'

await runMigrations(db, client)
console.info(`[db] migrations applied from ${migrationsFolder}`)

// the pool would keep the process alive
await closeDb()
