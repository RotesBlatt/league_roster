import { defineConfig } from 'drizzle-kit'

// Run from the repo root: `bun run db:generate` / `bun run db:migrate`.
// (drizzle-kit bundles this file, so import.meta.dir is not available here.)
export default defineConfig({
  dialect: 'postgresql',
  schema: './apps/api/src/db/schema.ts',
  out: './apps/api/drizzle',
  strict: true,
  verbose: true,
  dbCredentials: {
    // compose/db service or local Postgres; see .env.example
    url: process.env.DATABASE_URL ?? 'postgres://lol:lol@localhost:5432/lol',
  },
})
