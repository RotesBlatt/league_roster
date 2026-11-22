/**
 * One `auth-client` mock for every UI test, for the same reason as `api-mock.ts`: `mock.module` is
 * **process-wide** in bun, so a file that brings its own factory replaces the module for every file
 * that runs afterwards. That already bit us once — a mock exporting only `signOut` made
 * `LoginPage`'s import of `signInWithDiscord` fail in an unrelated test, as a `SyntaxError`.
 *
 * Keep the surface complete: whatever the real module exports, this exports too.
 */
import { mock } from 'bun:test'

export function installAuthMock() {
  mock.module('../src/api/auth.ts', () => ({
    authClient: {},
    signInWithDiscord: async () => {},
    signOut: async () => {},
  }))
}
