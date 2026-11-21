import { createApi } from './api-client.ts'

/**
 * Typed client generated from the Elysia app type. Same origin, so cookies and the dev proxy
 * just work. Route + body changes in the API fail `bun run typecheck` here.
 *
 * Construction (and `parseDate: false`) lives in `api-client.ts` so it can be tested without the
 * app-wide `api.ts` mock every other UI test uses.
 */
export const api = createApi(window.location.origin)

// re-exported so callers keep using `./api.ts` for everything Eden-related
export { ApiError, type EdenResult, messageOf, unwrap } from './api-result.ts'
