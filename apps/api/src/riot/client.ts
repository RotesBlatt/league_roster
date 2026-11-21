import { type Platform, platformRegion } from '@lol/shared'
import { type Ranks, type RiotError, toRanks, toRiotError } from './mappers.ts'
import { parseAccount, parseLeague, parseSummoner, RiotPaths } from './wire.ts'

/**
 * The only module that speaks Riot (riot-api.md §1). Everything Riot-shaped lives here: two host
 * families, the header, the timeout, the three-call composition. Routes get `lookupAccount()` and
 * our shapes — never a URL, never a Riot payload.
 *
 * `fetch` is injected for the same reason `db` and `auth` are: a test must be able to answer 404,
 * 429, 403 and "the socket hung" without a network call.
 */

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<Response>

export type LookupInput = {
  gameName: string
  tagLine: string
  platform: Platform
}

/** What we store from one check: identity, the summoner facts, and both ranked queues. */
export type AccountSnapshot = {
  puuid: string
  /** Riot's *canonical* label, not what the player typed — that is how a rename lands here (§2). */
  gameName: string
  tagLine: string
  summonerLevel: number | null
  profileIconId: number | null
  ranks: Ranks
}

export type LookupResult =
  | { ok: true; account: AccountSnapshot; partial: boolean }
  | { ok: false; error: RiotError }

export type RiotClient = {
  lookupAccount(input: LookupInput): Promise<LookupResult>
}

export type RiotClientOptions = {
  apiKey: string
  /** `globalThis.fetch` in production; a stub in tests. */
  fetch?: FetchLike
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 5_000

const host = (name: string) => `https://${name}.api.riotgames.com`

/** The spec's own placeholders, filled and encoded in one place. */
function fillPath(template: string, params: Record<string, string>): string {
  return Object.entries(params).reduce(
    (path, [name, value]) => path.replace(`{${name}}`, encodeURIComponent(value)),
    template,
  )
}

type Call<T> = { ok: true; value: T } | { ok: false; error: RiotError }

/**
 * One HTTP call → a value or a `RiotError`. Nothing here throws: a hung socket is `timeout`, a
 * broken body is `unavailable`, and a non-2xx goes through the status mapping in `mappers.ts`.
 */
function createRequest(
  options: Required<Pick<RiotClientOptions, 'apiKey' | 'fetch' | 'timeoutMs'>>,
) {
  return async function request<T>(
    hostName: string,
    path: string,
    parse: (body: unknown) => T | null,
  ): Promise<Call<T>> {
    let response: Response
    try {
      response = await options.fetch(`${host(hostName)}${path}`, {
        headers: { 'X-Riot-Token': options.apiKey },
        signal: AbortSignal.timeout(options.timeoutMs),
      })
    } catch {
      // timeout, DNS, reset: the player cannot act on the difference, so one kind covers them
      return { ok: false, error: { kind: 'timeout' } }
    }

    if (!response.ok) {
      return {
        ok: false,
        error: toRiotError(response.status, response.headers.get('retry-after')),
      }
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      return { ok: false, error: { kind: 'unavailable' } }
    }

    const value = parse(body)
    // a body that parsed to JSON but not to our shape must not become a half-filled account
    return value === null ? { ok: false, error: { kind: 'unavailable' } } : { ok: true, value }
  }
}

export function createRiotClient({
  apiKey,
  fetch = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: RiotClientOptions): RiotClient {
  const request = createRequest({ apiKey, fetch, timeoutMs })

  return {
    /**
     * Account + summoner + rank, composed here rather than in the route (§3): one budget number,
     * one fake to configure, one place where "partial" is decided.
     *
     * Step 1 failing is a failed lookup (`not_found`, `forbidden`, …). Steps 2–3 failing is a
     * **partial** success: the account exists, we simply have less to show, and the row is stored
     * unverified without being an error (§5).
     */
    async lookupAccount({ gameName, tagLine, platform }) {
      // the rule the wiring relies on: no key, no call — not even a rejected one
      if (apiKey.length === 0) return { ok: false, error: { kind: 'forbidden' } }

      const region = platformRegion(platform)
      // the platform is guarded at the boundary; a value outside our list must not become a host
      if (region === null) return { ok: false, error: { kind: 'bad_request' } }

      const account = await request(
        region,
        fillPath(RiotPaths.accountByRiotId, { gameName, tagLine }),
        parseAccount,
      )
      if (!account.ok) return account

      const byPuuid = { encryptedPUUID: account.value.puuid }
      const summoner = await request(
        platform,
        fillPath(RiotPaths.summonerByPuuid, byPuuid),
        parseSummoner,
      )
      const league = await request(
        platform,
        fillPath(RiotPaths.leagueEntriesByPuuid, byPuuid),
        parseLeague,
      )

      return {
        ok: true,
        partial: !summoner.ok || !league.ok,
        account: {
          ...account.value,
          summonerLevel: summoner.ok ? summoner.value.summonerLevel : null,
          profileIconId: summoner.ok ? summoner.value.profileIconId : null,
          ranks: league.ok ? toRanks(league.value) : { solo: null, flex: null },
        },
      }
    },
  }
}

/** One canned answer per step; an unconfigured step answers 404, never a plausible invention. */
export type FakeAnswer = { body: unknown } | { status: number; retryAfter?: string }

/**
 * `'echo'` answers the Riot ID that was asked for, with a puuid derived from it. Route tests that
 * add several accounts need each one to be a distinct player, which a single canned body is not.
 */
type FakeAccountAnswer = FakeAnswer | 'echo'

export type FakeRiotOptions = {
  account?: FakeAccountAnswer
  summoner?: FakeAnswer
  league?: FakeAnswer
}

export type FakeRiotClient = RiotClient & {
  /** The URLs that were asked for, in order — the budget is countable in tests. */
  calls: string[]
}

/**
 * The real client over a canned `fetch`, not a second implementation: the composition, parsers and
 * mapping are the ones production runs, so a route test cannot pass against a fake that drifted.
 */
export function createFakeRiotClient(options: FakeRiotOptions = {}): FakeRiotClient {
  const calls: string[] = []

  const answer = (canned: FakeAnswer | undefined, fallback: () => Response) => {
    if (canned === undefined) return fallback()
    if ('body' in canned) return new Response(JSON.stringify(canned.body), { status: 200 })

    const headers = canned.retryAfter ? { 'retry-after': canned.retryAfter } : undefined
    return new Response(JSON.stringify({ status: canned.status }), {
      status: canned.status,
      headers,
    })
  }

  const notFound = () => new Response(JSON.stringify({ status: 404 }), { status: 404 })

  /** `…/accounts/by-riot-id/{gameName}/{tagLine}` answered as the caller asked it. */
  const echo = (url: string) => {
    const [, , , , , , rawName, rawTag] = new URL(url).pathname.split('/')
    const gameName = decodeURIComponent(rawName ?? '')
    const tagLine = decodeURIComponent(rawTag ?? '')

    return new Response(
      JSON.stringify({ puuid: `puuid-${gameName}-${tagLine}`, gameName, tagLine }),
      { status: 200 },
    )
  }

  const fetch: FetchLike = async (url) => {
    calls.push(url)

    if (url.includes('/riot/account/v1/')) {
      return options.account === 'echo' ? echo(url) : answer(options.account, notFound)
    }
    if (url.includes('/lol/summoner/v4/')) return answer(options.summoner, notFound)

    return answer(options.league, () => new Response('[]', { status: 200 }))
  }

  return { ...createRiotClient({ apiKey: 'fake-key', fetch }), calls }
}
