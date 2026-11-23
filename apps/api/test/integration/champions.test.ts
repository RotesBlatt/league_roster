import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { ChampionsDto } from '../../src/db/schema.types.ts'
import { createHexserveClient, type FetchLike } from '../../src/hexserve/client.ts'
import {
  createSessionCookie,
  createTestApp,
  createTestContext,
  createUser,
  type TestContext,
  type TestServer,
} from './helpers.ts'

/**
 * `GET /api/champions` — the one place the SPA learns champion names, icons and which patch it is
 * looking at (hexserve-champion-data.md §6, §7).
 *
 * The endpoint must be able to answer in all three cache states and **never** be the reason a page
 * fails: an empty cache is ids and placeholders, an unreachable dump is the labels we already have,
 * and neither is an error status.
 */
let ctx: TestContext
let server: TestServer
let cookie: string

const VERSION = {
  version: '16.23.1',
  lastUpdate: '2026-11-19T18:40:23.358Z',
  timestamp: 1795113623,
  history: [
    { version: '16.22.1', lastUpdate: '2026-11-05T10:00:00.000Z', timestamp: 1794000000 },
    { version: '16.23.1', lastUpdate: '2026-11-19T18:40:23.358Z', timestamp: 1795113623 },
  ],
}

const CHAMPIONS = {
  version: '16.23.1',
  locale: 'en_US',
  champions: [
    {
      id: 266,
      name: 'Aatrox',
      slug: 'aatrox',
      iconUrl: 'https://cdn/266.png',
      positions: ['TOP'],
      roles: ['FIGHTER'],
    },
    {
      id: 1,
      name: 'Annie',
      slug: 'annie',
      iconUrl: 'https://cdn/1.png',
      positions: ['MIDDLE'],
      roles: ['MAGE'],
    },
  ],
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/** A dump the test can turn off, so "unreachable" is a real answer and not a mock of our code. */
function stubDump() {
  const state = {
    up: true,
    versionCalls: 0,
    championCalls: 0,
    version: (() => json(VERSION)) as () => Response,
    champions: (() => json(CHAMPIONS)) as () => Response,
  }

  const fetch: FetchLike = async (url) => {
    if (!state.up) throw new Error('ECONNREFUSED')
    if (url.endsWith('/version.json')) {
      state.versionCalls += 1
      return state.version()
    }
    state.championCalls += 1
    return state.champions()
  }

  return { state, client: createHexserveClient({ baseUrl: 'https://dump.test', fetch }) }
}

beforeAll(async () => {
  ctx = await createTestContext()
  const userId = await createUser(ctx, { name: 'Julius' })
  cookie = await createSessionCookie(ctx, userId)
})

afterAll(async () => {
  await server.close()
  await ctx.drop()
})

async function read(): Promise<{ status: number; body: ChampionsDto }> {
  const response = await server.call('/api/champions', { cookie })
  return { status: response.status, body: (await response.json()) as ChampionsDto }
}

describe('GET /api/champions', () => {
  test('without a session it is a 401, not an empty champion list', async () => {
    const { client } = stubDump()
    server = createTestApp(ctx, { hexserve: client })

    const response = await server.call('/api/champions')

    expect(response.status).toBe(401)
  })

  test('an empty cache answers 200 with no patch and no champions — never an error', async () => {
    const { state, client } = stubDump()
    state.up = false
    server = createTestApp(ctx, { hexserve: client })

    const { status, body } = await read()

    expect(status).toBe(200)
    expect(body).toMatchObject({ patch: null, previousPatch: null, state: 'empty', champions: [] })
    expect(body.patchPublishedAt).toBeNull()
    expect(body.fetchedAt).toBeNull()
  })

  test('the first read fetches, stores, and returns flattened labels plus the patch facts', async () => {
    const { client } = stubDump()
    server = createTestApp(ctx, { hexserve: client })

    const { status, body } = await read()

    expect(status).toBe(200)
    expect(body.state).toBe('current')
    expect(body.patch).toBe('16.23.1')
    // a fresh install has fetched one patch, so there is no second slot to report yet — two is a
    // ceiling, and the history's 16.22.1 was never fetched (patch 4's rule)
    expect(body.previousPatch).toBeNull()
    expect(body.patchPublishedAt).toBe(Date.parse('2026-11-19T18:40:23.358Z'))
    expect(typeof body.fetchedAt).toBe('number')

    // one row per id, ordered by id — the flatten rule, resolved server-side (§6)
    expect(body.champions.map((champion) => champion.championId)).toEqual([1, 266])
    expect(body.champions[0]).toMatchObject({ name: 'Annie', iconUrl: 'https://cdn/1.png' })
  })

  test('an unreachable dump keeps serving the labels we hold, as `previous`', async () => {
    const { state, client } = stubDump()
    state.up = false
    server = createTestApp(ctx, { hexserve: client })

    const { status, body } = await read()

    expect(status).toBe(200)
    expect(body.state).toBe('previous')
    expect(body.champions).toHaveLength(2)
    // the patch facts were stored with the rows, so they survive the outage
    expect(body.patch).toBe('16.23.1')
    expect(body.patchPublishedAt).toBe(Date.parse('2026-11-19T18:40:23.358Z'))
  })
})
