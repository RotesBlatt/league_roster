/**
 * Test harness preloaded via bunfig.toml (root + apps/web) before any test file loads.
 *
 * Order matters and cannot be expressed with static imports: @testing-library captures
 * `document` when it is imported, so the DOM has to exist first. Everything that touches the
 * DOM is therefore imported dynamically, after registration.
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator'

if (!globalThis.document) {
  GlobalRegistrator.register({ url: 'http://localhost:5173/' })
}

const { cleanup } = await import('@testing-library/react')
const { afterEach } = await import('bun:test')

// Without this every test keeps its tree mounted, so later queries see stale DOM.
afterEach(() => cleanup())
