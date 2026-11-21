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
 * What a save writes (riot-api.md §5): the server re-resolves, stores what Riot said, and refuses
 * to fall over when Riot cannot answer. "Unverified" is a row, not a failure — and the client's
 * claims (`puuid`, rank) are never read.
 */
let ctx: TestContext

const ACCOUNT = { puuid: 'PUUID-1', gameName: 'Canonical Name', tagLine: 'EUW' }
const SUMMONER = { summonerLevel: 512, profileIconId: 4568 }
const LEAGUE = [
  { queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'II' },
  { queueType: 'RANKED_FLEX_SR', tier: 'CHALLENGER', rank: 'I' },
]

const typed = { gameName: 'typed name', tagLine: 'EUW' }

type Account = {
  id: string
  gameName: string
  tagLine: string
  platform: string
  isMain: boolean
  verifiedAt: number | null
  fetchedAt: number | null
  summonerLevel: number | null
  profileIconId: number | null
  ranks: { solo: unknown; flex: unknown }
}

type Harness = {
  riot: FakeRiotClient
  server: TestServer
  add: (input?: unknown) => Promise<{ status: number; body: unknown; calls: string[] }>
  list: () => Promise<Account[]>
}

/** A fresh player per test, so the per-user unique index cannot make tests order-dependent. */
async function withApp<T>(
  fake: FakeRiotOptions,
  fn: (app: Harness) => Promise<T>,
  throttle: ThrottleOptions = {},
): Promise<T> {
  const riot = createFakeRiotClient(fake)
  const server = createTestApp(ctx, { riot, riotThrottle: createThrottle(throttle) })
  const cookie = await createSessionCookie(ctx, await createUser(ctx, {}))

  const add = async (input: unknown = typed) => {
    const response = await server.call('/api/me/riot-accounts', {
      method: 'POST',
      body: input,
      cookie,
    })
    return {
      status: response.status,
      body: await response.json().catch(() => null),
      calls: riot.calls,
    }
  }

  const list = async () =>
    (await (await server.call('/api/me/riot-accounts', { cookie })).json()) as Account[]

  try {
    return await fn({ riot, server, add, list })
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
})

afterAll(async () => {
  await ctx.drop()
})

describe('POST /api/me/riot-accounts writes what Riot said', () => {
  test('a full lookup stores the canonical label, the puuid and both ranks, and verifies', async () => {
    await withApp(fullFake(), async ({ add, list }) => {
      const saved = await add()

      expect(saved.status).toBe(200)
      expect(saved.calls).toHaveLength(3)

      const [row] = await list()
      expect(row).toMatchObject({
        // Riot's label, not the one the client typed: that is how a rename lands here
        gameName: 'Canonical Name',
        tagLine: 'EUW',
        platform: 'euw1',
        summonerLevel: 512,
        profileIconId: 4568,
        // Master and above have no division, so the DTO says null instead of Riot's "I"
        ranks: {
          solo: { tier: 'GOLD', division: 'II' },
          flex: { tier: 'CHALLENGER', division: null },
        },
      })
      expect(row?.verifiedAt).toBeNumber()
      expect(row?.fetchedAt).toBeNumber()
    })
  })

  test('the client’s puuid and rank are ignored — only Riot’s answer is written', async () => {
    await withApp(fullFake(), async ({ add, list }) => {
      await add({ ...typed, puuid: 'CLIENT-CLAIMED', soloTier: 'DIAMOND', verifiedAt: 1 })

      const [row] = await list()
      expect(row).toMatchObject({ ranks: { solo: { tier: 'GOLD', division: 'II' } } })
    })
  })

  test('a dead key still saves: unverified, no puuid, no snapshot, and no error', async () => {
    await withApp({ account: { status: 403 } }, async ({ add, list }) => {
      expect((await add()).status).toBe(200)

      const [row] = await list()
      expect(row).toMatchObject({
        // the player's own label is all we have
        gameName: typed.gameName,
        tagLine: typed.tagLine,
        verifiedAt: null,
        fetchedAt: null,
        summonerLevel: null,
        ranks: { solo: null, flex: null },
      })
    })
  })

  test('a partial lookup keeps the data it got and stays unverified', async () => {
    await withApp(
      { account: { body: ACCOUNT }, summoner: { status: 403 }, league: { body: LEAGUE } },
      async ({ add, list }) => {
        expect((await add()).status).toBe(200)

        const [row] = await list()
        expect(row?.verifiedAt).toBeNull()
        expect(row?.fetchedAt).toBeNumber()
        expect(row?.summonerLevel).toBeNull()
        expect(row).toMatchObject({ ranks: { solo: { tier: 'GOLD', division: 'II' } } })
      },
    )
  })

  test('a Riot ID that does not exist is refused, not stored as unverified', async () => {
    await withApp({ account: { status: 404 } }, async ({ add, list }) => {
      const refused = await add()

      expect(refused.status).toBe(404)
      expect(refused.body).toMatchObject({
        message: 'No such Riot ID on that platform — check name, tag',
      })
      expect(await list()).toEqual([])
    })
  })

  test('being throttled saves unverified instead of blocking onboarding', async () => {
    await withApp(
      fullFake(),
      async ({ add, list }) => {
        expect((await add()).status).toBe(200)

        const second = await add({ gameName: 'another name', tagLine: 'EUW' })
        expect(second.status).toBe(200)
        // the first save's three calls only: the throttled one never reached Riot
        expect(second.calls).toHaveLength(3)

        const rows = await list()
        const throttled = rows.find((row) => row.gameName === 'another name')
        expect(throttled?.verifiedAt).toBeNull()
        expect(throttled?.fetchedAt).toBeNull()
      },
      { limit: 1 },
    )
  })

  test('euw1 is the default platform when the form does not send one', async () => {
    await withApp(fullFake(), async ({ add, list }) => {
      await add()

      expect((await list())[0]?.platform).toBe('euw1')
    })
  })

  test('the chosen platform is stored as chosen', async () => {
    await withApp(fullFake(), async ({ add, list }) => {
      await add({ ...typed, platform: 'na1' })

      expect((await list())[0]?.platform).toBe('na1')
    })
  })

  test('an unknown platform is a 422 and never reaches Riot', async () => {
    await withApp(fullFake(), async ({ add }) => {
      const out = await add({ ...typed, platform: 'europe' })

      expect(out.status).toBe(422)
      expect(out.calls).toHaveLength(0)
    })
  })
})
