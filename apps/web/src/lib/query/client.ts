import { type DefaultOptions, QueryClient } from '@tanstack/react-query'

/**
 * The app's one React Query client, built from defaults that are written down once.
 *
 * `refetchOnWindowFocus` is deliberately **on** (realtime.md §3, Tier 0). The situation it covers is
 * the normal one here: six people, mostly idle, who leave a page open while they are in Discord or
 * the draft tool and come back to it. Without the flag they read whatever the tab loaded 20 minutes
 * ago; with it, "I came back" is a refetch — the cheapest reactive behaviour there is, and no server
 * change at all.
 *
 * `retry: 1` because the stock default of 3 turns one flaky request into four round trips before the
 * member sees anything.
 *
 * This module exists instead of an inline literal in `main.tsx` so the defaults can be asserted in a
 * unit test without a DOM — the logic-in-plain-modules rule that the rest of `src/lib/` follows.
 */
export const queryDefaults: DefaultOptions = {
  queries: { retry: 1, refetchOnWindowFocus: true },
}

export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: queryDefaults })
}
