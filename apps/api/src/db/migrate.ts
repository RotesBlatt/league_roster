import { env } from '../env.ts'
import { createDestinations } from '../lib/log/destinations.ts'
import { logMigrate } from '../lib/log/lifecycle.ts'
import { createLogger } from '../lib/log/logger.ts'
import { client, closeDb, db } from './index.ts'
import { migrationsFolder, runMigrations } from './migrations.ts'

const destinations = await createDestinations(env.log)
const logger = createLogger({ level: env.log.level, destination: destinations })

const started = Date.now()
await runMigrations(db, client)
logMigrate(logger, migrationsFolder, Date.now() - started)

// the pool would keep the process alive
await closeDb()
await destinations.close()
