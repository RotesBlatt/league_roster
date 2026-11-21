/**
 * Integration test runner: makes sure Postgres is reachable, then runs the tests in
 * apps/api/test with TEST_DATABASE_URL pointing at the database those tests use to create
 * and drop throwaway databases.
 */
import { resolve } from 'node:path'
import postgres from 'postgres'

const root = resolve(import.meta.dir, '..')
const adminUrl = process.env.DATABASE_URL

if (!adminUrl) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env (docker compose up -d db).')
  process.exit(1)
}

const redacted = adminUrl.replace(/:[^:@/]*@/, ':***@')

const probe = postgres(adminUrl, { max: 1, onnotice: () => {} })
try {
  await probe`select 1`
  console.info(`[test:db] Postgres reachable at ${redacted}`)
} catch (error) {
  console.error(
    `[test:db] cannot reach Postgres at ${redacted}\n` +
      `  start it with: docker compose up -d db\n` +
      `  cause: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exit(1)
} finally {
  await probe.end({ timeout: 5 })
}

// `--parallel`: every integration file owns a throwaway database named after a UUID, so the
// files cannot collide. 14s sequential, ~4s here. Not for the unit or web suite: the web tests
// mock whole modules, which `--parallel` (it implies `--isolate`) does not survive.
const proc = Bun.spawn([process.execPath, 'test', '--parallel', 'apps/api/test/integration'], {
  cwd: root,
  stdio: ['inherit', 'inherit', 'inherit'],
  env: { ...process.env, TEST_DATABASE_URL: adminUrl },
})

process.exit(await proc.exited)
