import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  createFakeRiotClient,
  type FakeRiotClient,
  type FakeRiotOptions,
} from '../../src/riot/client.ts'
import { createThrottle, type ThrottleOptions } from '../../src/riot/throttle.ts'
import {
  createSessionCookie,
  createTestApp,
  createTestContext,
  createUser,
  type TestContext,
  type TestServer,
} from './helpers.ts'

/**
 * `POST /api/me/riot-accounts/lookup` — the explicit Check (riot-api.md §4, §6).
 *
 * What is pinned here is the *contract with the player*, not the client internals (those are unit
 * tested): the guard, one sentence per outcome, the budget being spent before Riot is called, and
 * the rule that a check writes nothing and trusts nothing from the client.
 */
let ctx: TestContext
let cookie: string

const lookup = { gameName: 'Hide on bush', tagLine: 'EUW', platform: 'euw1' }
const ACCOUNT = { puuid: 'PUUID-1', gameName: 'Hide on bush', tagLine: 'EUW' }
const SUMMONER = { summonerLevel: 512, profileIconId: 4568 }
const LEAGUE = [
  { queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'II' },
  { queueType: 'RANKED_FLEX_SR', tier: 'SILVER', rank: 'IV' },
]

type Outcome = {
  status: number
  body: unknown
  retryAfter: string | null
  calls: string[]
}

type Harness = {
  riot: FakeRiotClient
  server: TestServer
  post: (input?: unknown, who?: string | null) => Promise<Outcome>
}

/** One app per test: the fake and the throttle are per-app, so tests cannot leak into each other. */
async function withApp<T>(
  fake: FakeRiotOptions,
  fn: (app: Harness) => Promise<T>,
  throttle: ThrottleOptions = {},
): Promise<T> {
  const riot = createFakeRiotClient(fake)
  const server = createTestApp(ctx, { riot, riotThrottle: createThrottle(throttle) })

  const post = async (input: unknown = lookup, who: string | null = cookie): Promise<Outcome> => {
    const response = await server.call('/api/me/riot-accounts/lookup', {
      method: 'POST',
      body: input,
      ...(who === null ? {} : { cookie: who }),
    })

    return {
      status: response.status,
      body: await response.json().catch(() => null),
      retryAfter: response.headers.get('retry-after'),
      calls: riot.calls,
    }
  }

  try {
    return await fn({ riot, server, post })
  } finally {
    server.close()
  }
}

const fullFake = (): FakeRiotOptions => ({
  account: { body: ACCOUNT },
  summoner: { body: SUMMONER },
  league: { body: LEAGUE },
})

beforeAll(async () => {
  ctx = await createTestContext()
  cookie = await createSessionCookie(ctx, await createUser(ctx, { name: 'Julius' }))
})

afterAll(async () => {
  await ctx.drop()
})

describe('POST /api/me/riot-accounts/lookup', () => {
  test('signed out is 401, and Riot is never called', async () => {
    await withApp(fullFake(), async ({ post }) => {
      const out = await post(lookup, null)

      expect(out.status).toBe(401)
      expect(out.calls).toHaveLength(0)
    })
  })

  test('the happy path returns the composed snapshot and writes nothing', async () => {
    await withApp(fullFake(), async ({ post, server }) => {
      const out = await post()

      expect(out.status).toBe(200)
      expect(out.body).toMatchObject({
        partial: false,
        account: {
          puuid: 'PUUID-1',
          gameName: 'Hide on bush',
          tagLine: 'EUW',
          summonerLevel: 512,
          profileIconId: 4568,
          ranks: {
            solo: { tier: 'GOLD', division: 'II' },
            flex: { tier: 'SILVER', division: 'IV' },
          },
        },
      })
      expect(out.calls).toHaveLength(3)

      // a check is a preview: the profile still has no account until it is added
      const accounts = await server.call('/api/me/riot-accounts', { cookie })
      expect(await accounts.json()).toEqual([])
    })
  })

  test('an unknown Riot ID is 404 and names platform in the same sentence as name and tag', async () => {
    await withApp({ account: { status: 404 } }, async ({ post }) => {
      const out = await post()

      expect(out.status).toBe(404)
      expect(out.body).toMatchObject({
        message: 'No such Riot ID on that platform — check name, tag and platform',
      })
      expect(out.calls).toHaveLength(1)
    })
  })

  test('a wrong platform keeps the account as partial instead of failing the check', async () => {
    await withApp(
      { account: { body: ACCOUNT }, summoner: { status: 404 }, league: { body: [] } },
      async ({ post }) => {
        const out = await post()

        expect(out.status).toBe(200)
        expect(out.body).toMatchObject({
          partial: true,
          account: { puuid: 'PUUID-1', summonerLevel: null, profileIconId: null },
        })
      },
    )
  })

  test('an unranked player is a full success with no ranks', async () => {
    await withApp(
      { account: { body: ACCOUNT }, summoner: { body: SUMMONER }, league: { body: [] } },
      async ({ post }) => {
        const out = await post()

        expect(out.status).toBe(200)
        expect(out.body).toMatchObject({
          partial: false,
          account: { ranks: { solo: null, flex: null } },
        })
      },
    )
  })

  test('Riot’s Retry-After is passed on when Riot is the one rate limiting', async () => {
    await withApp({ account: { status: 429, retryAfter: '7' } }, async ({ post }) => {
      const out = await post()

      expect(out.status).toBe(429)
      expect(out.retryAfter).toBe('7')
      expect(out.body).toMatchObject({ message: 'Too many Riot checks — try again in a moment' })
    })
  })

  test('a dead key is 503 and says saving still works — the player is not blocked', async () => {
    await withApp({ account: { status: 403 } }, async ({ post }) => {
      const out = await post()

      expect(out.status).toBe(503)
      expect(out.body).toMatchObject({
        message: 'Riot check is unavailable — you can still save the account',
      })
    })
  })

  test('our own throttle answers before Riot does, so a denied press costs zero requests', async () => {
    await withApp(
      fullFake(),
      async ({ post }) => {
        expect((await post()).status).toBe(200)

        const denied = await post()
        expect(denied.status).toBe(429)
        expect(denied.body).toMatchObject({ retryAfterSeconds: 60 })
        expect(denied.retryAfter).toBe('60')
        // three calls from the first press, none from the second
        expect(denied.calls).toHaveLength(3)
      },
      { limit: 1 },
    )
  })

  test('a platform outside our list is 422, and no host is guessed', async () => {
    await withApp(fullFake(), async ({ post }) => {
      const out = await post({ ...lookup, platform: 'europe' })

      expect(out.status).toBe(422)
      expect(out.body).toMatchObject({
        details: [{ path: 'platform', message: 'Unknown platform' }],
      })
      expect(out.calls).toHaveLength(0)
    })
  })

  test('an empty Riot ID is a field error, not a Riot call', async () => {
    await withApp(fullFake(), async ({ post }) => {
      const out = await post({ ...lookup, gameName: '   ' })

      expect(out.status).toBe(422)
      expect(out.body).toMatchObject({
        details: [{ path: 'gameName', message: 'Game name is required' }],
      })
      expect(out.calls).toHaveLength(0)
    })
  })

  test('a client-supplied puuid or rank is ignored — the server answers from Riot only', async () => {
    await withApp(fullFake(), async ({ post }) => {
      const out = await post({
        ...lookup,
        puuid: 'CLIENT-CLAIMED',
        soloTier: 'CHALLENGER',
        soloDivision: 'I',
      })

      expect(out.status).toBe(200)
      expect(out.body).toMatchObject({
        account: {
          puuid: 'PUUID-1',
          ranks: { solo: { tier: 'GOLD', division: 'II' } },
        },
      })
    })
  })
})
