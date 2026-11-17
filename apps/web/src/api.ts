import { treaty } from '@elysiajs/eden'
import type { App } from '@lol/api'

/**
 * Typed client generated from the Elysia app type. Same origin, so cookies and the dev proxy
 * just work. Route + body changes in the API fail `bun run typecheck` here.
 */
export const api = treaty<App>(window.location.origin).api

// re-exported so callers keep using `./api.ts` for everything Eden-related
export { ApiError, type EdenResult, messageOf, unwrap } from './api-result.ts'
