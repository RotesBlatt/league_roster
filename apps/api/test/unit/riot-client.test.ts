import { describe, expect, test } from 'bun:test'
import type { Platform } from '@lol/shared'
import { createFakeRiotClient, createRiotClient, type FetchLike } from '../../src/riot/client.ts'

/**
 * `lookupAccount` is the only useful unit for a profile check, and the only place two host families
 * meet (riot-api.md §2–§3). No network here: the injected `fetch` answers, records the order, and
 * can hang, 403 or return nonsense — which a route test could never do honestly.
 */

type Recorded = { url: string; headers: Record<string, string>; signal: AbortSignal }

const ACCOUNT = {
  puuid: 'PUUID-1',
  gameName: 'Hide on bush',
  tagLine: 'EUW',
}
const SUMMONER = { summonerLevel: 512, profileIconId: 4568 }
const LEAGUE = [
  { queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'II' },
  { queueType: 'RANKED_FLEX_SR', tier: 'SILVER', rank: 'IV' },
]

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })

/** Answers the three calls by shape of the path, recording each one. */
function stubFetch(answers: {
  account?: () => Response
  summoner?: () => Response
  league?: () => Response
}): { fetch: FetchLike; calls: Recorded[] } {
  const calls: Recorded[] = []

  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, headers: init.headers, signal: init.signal })
      if (url.includes('/riot/account/v1/')) return (answers.account ?? (() => json(ACCOUNT)))()
      if (url.includes('/lol/summoner/v4/')) return (answers.summoner ?? (() => json(SUMMONER)))()
      if (url.includes('/lol/league/v4/')) return (answers.league ?? (() => json(LEAGUE)))()
      throw new Error(`unexpected url ${url}`)
    },
  }
}

const client = (fetch: FetchLike, apiKey = 'test-key') =>
  createRiotClient({ apiKey, fetch, timeoutMs: 1_000 })

const lookup = { gameName: 'Hide on bush', tagLine: 'EUW', platform: 'euw1' as Platform }

describe('createRiotClient — the happy path', () => {
  test('three calls, in the documented order, one composed result', async () => {
    const { fetch, calls } = stubFetch({})
    const result = await client(fetch).lookupAccount(lookup)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.partial).toBe(false)
    expect(result.account).toEqual({
      puuid: 'PUUID-1',
      gameName: 'Hide on bush',
      tagLine: 'EUW',
      summonerLevel: 512,
      profileIconId: 4568,
      ranks: { solo: { tier: 'GOLD', division: 'II' }, flex: { tier: 'SILVER', division: 'IV' } },
    })
    expect(calls).toHaveLength(3)
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/riot/account/v1/accounts/by-riot-id/Hide%20on%20bush/EUW',
      '/lol/summoner/v4/summoners/by-puuid/PUUID-1',
      '/lol/league/v4/entries/by-puuid/PUUID-1',
    ])
  })

  test('the account call goes to the regional host, the other two to the platform host', async () => {
    const { fetch, calls } = stubFetch({})
    await client(fetch).lookupAccount({ ...lookup, platform: 'na1' as Platform })

    expect(calls.map((call) => new URL(call.url).host)).toEqual([
      'americas.api.riotgames.com',
      'na1.api.riotgames.com',
      'na1.api.riotgames.com',
    ])
  })

  test('the key travels as X-Riot-Token, and a timeout signal is always set', async () => {
    const { fetch, calls } = stubFetch({})
    await client(fetch, 'secret-key').lookupAccount(lookup)

    for (const call of calls) {
      expect(call.headers['X-Riot-Token']).toBe('secret-key')
      expect(call.signal).toBeInstanceOf(AbortSignal)
    }
  })
})

describe('createRiotClient — failures are values', () => {
  test('404 on step 1 is not_found, and nothing else is called', async () => {
    const { fetch, calls } = stubFetch({ account: () => json({ status: 404 }, 404) })
    const result = await client(fetch).lookupAccount(lookup)

    expect(result).toEqual({ ok: false, error: { kind: 'not_found' } })
    expect(calls).toHaveLength(1)
  })

  test('404 on step 2 keeps the puuid and is partial — the classic wrong-platform case', async () => {
    const { fetch } = stubFetch({ summoner: () => json({ status: 404 }, 404) })
    const result = await client(fetch).lookupAccount(lookup)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.partial).toBe(true)
    expect(result.account.puuid).toBe('PUUID-1')
    expect(result.account.summonerLevel).toBeNull()
    expect(result.account.profileIconId).toBeNull()
    // the rank call still ran, so what Riot could answer is shown
    expect(result.account.ranks.solo).toEqual({ tier: 'GOLD', division: 'II' })
  })

  test('404 on step 3 only is partial with no ranks, and the level is kept', async () => {
    const { fetch } = stubFetch({ league: () => json({ status: 404 }, 404) })
    const result = await client(fetch).lookupAccount(lookup)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.partial).toBe(true)
    expect(result.account.summonerLevel).toBe(512)
    expect(result.account.ranks).toEqual({ solo: null, flex: null })
  })

  test('an unranked player is an empty list, not a failure: not partial', async () => {
    const { fetch } = stubFetch({ league: () => json([]) })
    const result = await client(fetch).lookupAccount(lookup)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.partial).toBe(false)
    expect(result.account.ranks).toEqual({ solo: null, flex: null })
  })

  test('429 keeps Retry-After and does not retry — the budget is shared', async () => {
    const { fetch, calls } = stubFetch({
      account: () => json({}, 429, { 'retry-after': '7' }),
    })
    const result = await client(fetch).lookupAccount(lookup)

    expect(result).toEqual({ ok: false, error: { kind: 'rate_limited', retryAfterSeconds: 7 } })
    expect(calls).toHaveLength(1)
  })

  test('403 is forbidden — the operator’s key, not the player’s typo', async () => {
    const { fetch } = stubFetch({ account: () => json({}, 403) })

    expect(await client(fetch).lookupAccount(lookup)).toEqual({
      ok: false,
      error: { kind: 'forbidden' },
    })
  })

  test('a hung socket is timeout, not a rejection that reaches the route', async () => {
    const { fetch } = stubFetch({
      account: () => {
        throw new DOMException('The operation timed out.', 'TimeoutError')
      },
    })

    expect(await client(fetch).lookupAccount(lookup)).toEqual({
      ok: false,
      error: { kind: 'timeout' },
    })
  })

  test('a network error is timeout too — the UI has the same sentence for both', async () => {
    const { fetch } = stubFetch({
      account: () => {
        throw new TypeError('fetch failed')
      },
    })

    expect(await client(fetch).lookupAccount(lookup)).toEqual({
      ok: false,
      error: { kind: 'timeout' },
    })
  })

  test('a body that is not JSON is unavailable, not a crash', async () => {
    const { fetch } = stubFetch({ account: () => new Response('<html>', { status: 200 }) })

    expect(await client(fetch).lookupAccount(lookup)).toEqual({
      ok: false,
      error: { kind: 'unavailable' },
    })
  })

  test('valid JSON of the wrong shape is unavailable, not a half-built account', async () => {
    const { fetch } = stubFetch({ account: () => json({ puuid: 'PUUID-1' }) })

    expect(await client(fetch).lookupAccount(lookup)).toEqual({
      ok: false,
      error: { kind: 'unavailable' },
    })
  })

  test('a platform outside our list is bad_request, and fetch is never called', async () => {
    const { fetch, calls } = stubFetch({})
    const result = await client(fetch).lookupAccount({
      ...lookup,
      platform: 'xx9' as Platform,
    })

    expect(result).toEqual({ ok: false, error: { kind: 'bad_request' } })
    expect(calls).toHaveLength(0)
  })

  test('no key means no call at all — the rule the whole wiring relies on', async () => {
    const { fetch, calls } = stubFetch({})
    const result = await client(fetch, '').lookupAccount(lookup)

    expect(result).toEqual({ ok: false, error: { kind: 'forbidden' } })
    expect(calls).toHaveLength(0)
  })
})

describe('createFakeRiotClient', () => {
  test('is the real client over canned payloads, so it cannot drift from it', async () => {
    const riot = createFakeRiotClient({
      account: { body: ACCOUNT },
      summoner: { body: SUMMONER },
      league: { body: LEAGUE },
    })
    const result = await riot.lookupAccount(lookup)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.account.ranks.solo).toEqual({ tier: 'GOLD', division: 'II' })
    expect(riot.calls).toHaveLength(3)
  })

  test('an error answer is configured per step', async () => {
    const riot = createFakeRiotClient({
      account: { body: ACCOUNT },
      summoner: { status: 403 },
      league: { body: [] },
    })
    const result = await riot.lookupAccount(lookup)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.partial).toBe(true)
      expect(result.account.summonerLevel).toBeNull()
    }
  })

  test('echo answers any Riot ID with a puuid derived from it', async () => {
    const riot = createFakeRiotClient({
      account: 'echo',
      summoner: { body: SUMMONER },
      league: { body: [] },
    })

    const first = await riot.lookupAccount(lookup)
    const second = await riot.lookupAccount({ ...lookup, gameName: 'Smurf' })

    expect(first.ok && first.account).toMatchObject({
      gameName: 'Hide on bush',
      puuid: 'puuid-Hide on bush-EUW',
    })
    expect(second.ok && second.account.puuid).toBe('puuid-Smurf-EUW')
  })

  test('with no account answer it is not_found, like an unknown Riot ID', async () => {
    expect(await createFakeRiotClient().lookupAccount(lookup)).toEqual({
      ok: false,
      error: { kind: 'not_found' },
    })
  })
})
