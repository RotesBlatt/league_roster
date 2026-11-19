/**
 * Points git at .githooks/ so the pre-commit hook actually runs.
 *
 * Safe everywhere: in a Docker build or a tarball there is no .git, and that is
 * not an error — there is simply nothing to configure. Never fails the install.
 */
import { existsSync } from 'node:fs'

if (!existsSync('.git')) {
  console.info('[hooks] no .git directory — skipping hook install')
  process.exit(0)
}

const result = Bun.spawnSync(['git', 'config', 'core.hooksPath', '.githooks'], {
  stdout: 'inherit',
  stderr: 'inherit',
})

if (result.exitCode !== 0) {
  console.warn('[hooks] could not set core.hooksPath — run `bun run hooks:install` manually')
}

process.exit(0)
