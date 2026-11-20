import type { Logger } from './logger.ts'

/** Silent logger for tests and optional dependencies. */
export const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return noopLogger
  },
}
