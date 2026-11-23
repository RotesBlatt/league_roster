import { describe, expect, test } from 'bun:test'
import {
  createHexserveClient,
  type FetchLike,
  HEXSERVE_BASE_URL,
} from '../../src/hexserve/client.ts'

/**
 * The only module that speaks to the dump (hexserve-champion-data.md §2, §7).
 *
 * No network: the injected `fetch` answers, records URLs, and can 404, hang or return nonsense.
 * The property this suite buys is "the dump can be down without a page breaking", so every failure
 * shape is asserted to produce `null` rather than a throw.
 */

const BASE = 'https://dump.test'

/** The live dump's real shape, trimmed to the fields we read (§2). */
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
  totalChampions: 2,
  champions: [
    {
      id: 1,
      key: 'Annie',
      name: 'Annie',
      slug: 'annie',
      iconUrl: 'https://raw.communitydragon.org/16.23/v1/champion-icons/1.png',
      attackType: 'Ranged',
      releaseDate: '2009-02-21',
      positions: ['MIDDLE'],
      roles: ['MAGE', 'BURST'],
    },
    {
      id: 266,
      key: 'Aatrox',
      name: 'Aatrox',
      slug: 'aatrox',
      iconUrl: 'https://raw.communitydragon.org/16.23/v1/champion-icons/266.png',
      positions: ['TOP'],
      roles: ['FIGHTER'],
    },
  ],
}

type Recorded = { url: string; signal: AbortSignal }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/** Answers by path, recording every URL; anything unconfigured is a 404, never an invention. */
function stubFetch(answers: { version?: () => Response; champions?: () => Response } = {}): {
  fetch: FetchLike
  calls: Recorded[]
} {
  const calls: Recorded[] = []

  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, signal: init.signal })
      if (url.endsWith('/version.json')) return (answers.version ?? (() => json(VERSION)))()
      if (url.includes('champion-index.json')) {
        return (answers.champions ?? (() => json(CHAMPIONS)))()
      }
      return json({ message: 'not found' }, 404)
    },
  }
}

describe('getVersionIndex', () => {
  test('reads version, last update and the patch history from one small file', async () => {
    const { fetch, calls } = stubFetch()
    const version = await createHexserveClient({ baseUrl: BASE, fetch }).getVersionIndex()

    expect(calls.map((call) => call.url)).toEqual([`${BASE}/version.json`])
    expect(version).toEqual({
      version: '16.23.1',
      lastUpdate: '2026-11-19T18:40:23.358Z',
      timestamp: 1795113623,
      history: VERSION.history,
    })
  })

  test('the current patch is always in the history, even if the dump omits it', async () => {
    const { fetch } = stubFetch({
      version: () =>
        json({
          version: '16.24.1',
          lastUpdate: '2026-12-01T10:00:00.000Z',
          timestamp: 1796000000,
          history: [{ version: '16.23.1', lastUpdate: '…', timestamp: 1795113623 }],
        }),
    })

    const version = await createHexserveClient({ baseUrl: BASE, fetch }).getVersionIndex()
    expect(version?.history.map((entry) => entry.version)).toEqual(['16.23.1', '16.24.1'])
  })

  test('unreadable history entries are dropped, not fatal — a bad append must not block a patch', async () => {
    const { fetch } = stubFetch({
      version: () =>
        json({
          version: '16.24.1',
          lastUpdate: '2026-12-01T10:00:00.000Z',
          timestamp: 1796000000,
          history: [
            { version: '16.23.1', timestamp: 1795113623 },
            { version: 42, timestamp: 1795000000 },
            { version: '16.22.1', lastUpdate: '…', timestamp: 'yesterday' },
            { version: '16.24.1', lastUpdate: '…', timestamp: 1796000000 },
          ],
        }),
    })

    const version = await createHexserveClient({ baseUrl: BASE, fetch }).getVersionIndex()
    expect(version?.history.map((entry) => entry.version)).toEqual(['16.23.1', '16.24.1'])
  })

  test('a failed read is null, never a throw: the dump is ours and may be restarting', async () => {
    const failures: Array<() => Response> = [
      () => json({ message: 'boom' }, 500),
      () => json({ message: 'nope' }, 404),
      () => new Response('<html>maintenance</html>', { status: 200 }),
      () => json({ version: '', lastUpdate: '', timestamp: 'x', history: [] }),
      () => json([1, 2, 3]),
    ]

    for (const version of failures) {
      const { fetch } = stubFetch({ version })
      expect(await createHexserveClient({ baseUrl: BASE, fetch }).getVersionIndex()).toBeNull()
    }
  })

  test('a hung socket times out instead of holding the request open', async () => {
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')))
      })

    expect(
      await createHexserveClient({ baseUrl: BASE, fetch, timeoutMs: 5 }).getVersionIndex(),
    ).toBeNull()
  })
})

describe('getChampionIndex', () => {
  test('the numeric dump `id` is our championId — match data is numeric, `key` is the name here', async () => {
    const { fetch, calls } = stubFetch()
    const champions = await createHexserveClient({ baseUrl: BASE, fetch }).getChampionIndex(
      '16.23.1',
      'en_US',
    )

    expect(calls.map((call) => call.url)).toEqual([`${BASE}/16.23.1/en_US/champion-index.json`])
    expect(champions).toEqual([
      {
        championId: 1,
        name: 'Annie',
        slug: 'annie',
        iconUrl: 'https://raw.communitydragon.org/16.23/v1/champion-icons/1.png',
        positions: ['MIDDLE'],
        roles: ['MAGE', 'BURST'],
      },
      {
        championId: 266,
        name: 'Aatrox',
        slug: 'aatrox',
        iconUrl: 'https://raw.communitydragon.org/16.23/v1/champion-icons/266.png',
        positions: ['TOP'],
        roles: ['FIGHTER'],
      },
    ])
  })

  test('one unreadable champion is dropped rather than costing the whole patch', async () => {
    const { fetch } = stubFetch({
      champions: () =>
        json({
          ...CHAMPIONS,
          champions: [
            { id: 1, name: 'Annie', slug: 'annie', iconUrl: 'https://x/1.png' },
            { id: 'bad', name: 'Broken' },
            { id: 2, name: '', slug: 'olaf', iconUrl: 'https://x/2.png' },
            { id: 3, slug: 'galio' },
          ],
        }),
    })

    const champions = await createHexserveClient({ baseUrl: BASE, fetch }).getChampionIndex(
      '16.23.1',
      'en_US',
    )
    // positions/roles are hints: absent is an empty list, not a reason to lose the champion
    expect(champions).toEqual([
      {
        championId: 1,
        name: 'Annie',
        slug: 'annie',
        iconUrl: 'https://x/1.png',
        positions: [],
        roles: [],
      },
    ])
  })

  test('an empty champion list is a valid answer; a non-list is not', async () => {
    const empty = stubFetch({ champions: () => json({ ...CHAMPIONS, champions: [] }) })
    expect(
      await createHexserveClient({ baseUrl: BASE, fetch: empty.fetch }).getChampionIndex(
        '16.23.1',
        'en_US',
      ),
    ).toEqual([])

    const broken = stubFetch({ champions: () => json({ ...CHAMPIONS, champions: 'nope' }) })
    expect(
      await createHexserveClient({ baseUrl: BASE, fetch: broken.fetch }).getChampionIndex(
        '16.23.1',
        'en_US',
      ),
    ).toBeNull()
  })

  test('patch and locale are encoded into the path, and a trailing slash on the base is one URL', async () => {
    const { fetch, calls } = stubFetch()
    await createHexserveClient({ baseUrl: `${BASE}/`, fetch }).getChampionIndex(
      '../16.23.1',
      'de_DE/',
    )

    expect(calls[0]?.url).toBe(`${BASE}/..%2F16.23.1/de_DE%2F/champion-index.json`)
  })

  test('an unreachable dump is null for champions too, never a throw', async () => {
    const fetch: FetchLike = async () => {
      throw new Error('ECONNREFUSED')
    }
    expect(
      await createHexserveClient({ baseUrl: BASE, fetch }).getChampionIndex('16.23.1', 'en_US'),
    ).toBeNull()
  })
})

describe('createHexserveClient', () => {
  test('the base URL has one definition, and it is not repeated at a call site', () => {
    expect(HEXSERVE_BASE_URL).toBe('https://hexserve.dump-collector.de')
  })
})
