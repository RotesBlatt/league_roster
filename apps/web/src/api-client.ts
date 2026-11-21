import { treaty } from '@elysiajs/eden'
import type { App } from '@lol/api'

/**
 * `parseDate: false` is load-bearing: Eden otherwise turns every date-shaped JSON *string* into a
 * `Date`, contradicting our DTOs (`profile.birthday` is `YYYY-MM-DD`, timestamps are epoch ms).
 * A birthday that arrives as a `Date` renders as an empty date input and never compares equal, so
 * autosave writes the same profile forever.
 */
export const TREATY_OPTIONS = { parseDate: false } as const

/**
 * The typed client, isolated from `window` so it can be tested with a stubbed `fetch`: the wire
 * types are the contract, and this is where they are kept honest.
 */
export function createApi(origin: string) {
  return treaty<App>(origin, TREATY_OPTIONS).api
}
