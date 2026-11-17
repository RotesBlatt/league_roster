import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Runs the API (Bun, hot reload) and the Vite dev server side by side.
 * Ctrl+C stops both.
 */

// <repo root>, cross-platform
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// process.execPath = the bun binary running this script. `Bun.spawn(['bun'])` fails on
// Windows because PATH lookup does not resolve `bun.exe`.
const bun = process.execPath

const api = Bun.spawn([bun, '--hot', 'apps/api/src/index.ts'], {
  cwd: root,
  stdio: ['inherit', 'inherit', 'inherit'],
  env: { ...process.env, NODE_ENV: 'development' },
})

const web = Bun.spawn([bun, 'x', 'vite'], {
  cwd: resolve(root, 'apps/web'),
  stdio: ['inherit', 'inherit', 'inherit'],
  env: { ...process.env, NODE_ENV: 'development' },
})

let shuttingDown = false
const shutdown = () => {
  if (shuttingDown) return
  shuttingDown = true
  api.kill()
  web.kill()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

const code = await Promise.race([api.exited, web.exited])
shutdown()
process.exit(code ?? 0)
