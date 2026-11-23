import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { asc, eq } from 'drizzle-orm'
import { championPatches, champions } from '../../src/db/schema.ts'
import { createHexserveClient, type FetchLike } from '../../src/hexserve/client.ts'
import { refreshChampions } from '../../src/hexserve/refresh.ts'
import { championCacheState } from '../../src/hexserve/rules.ts'
import { createTestContext, type TestContext } from './helpers.ts'

/**
 * The refresh is the only writer of the champion cache, and it runs lazily on a page request
 * (hexserve-champion-data.md §5). Three properties are what this suite exists for:
 *
 * 1. **It fetches only on a patch we do not hold** — a version comparison, never a TTL.
 * 2. **A failed or malformed dump never empties the cache.** The previous patch is the safety net
 *    that keeps a page from rendering every champion as a bare id.
 * 3. **Two requests at once cannot collide.** Lazy-on-GET makes that race ordinary on patch day,
 *    not exotic, and a 500 on patch day is exactly the failure this feature must not have.
 *
 * The real client over a canned `fetch`, like the Riot fake: the parse and validation under test
 * are the ones production runs.
 */
let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.drop()
})

/**
 * A realistic patch history: **consecutive** patches, as the dump publishes them. The first draft
 * of this file jumped `16.23.1 → 16.25.1`, which made the dump's own history name `16.23.1` as the
 * previous patch — so the prune correctly deleted `16.24.1` and the test failed for a reason that
 * had nothing to do with the code.
 */
const HISTORY = [
  { version: '16.22.1', lastUpdate: '2026-11-05T10:00:00.000Z', timestamp: 1794000000 },
  { version: '16.23.1', lastUpdate: '2026-11-19T18:40:23.358Z', timestamp: 1795113623 },
  { version: '16.24.1', lastUpdate: '2026-12-03T09:00:00.000Z', timestamp: 1796300000 },
  { version: '16.25.1', lastUpdate: '2026-12-17T09:00:00.000Z', timestamp: 1797500000 },
  { version: '16.26.1', lastUpdate: '2026-12-31T09:00:00.000Z', timestamp: 1798700000 },
  { version: '16.27.1', lastUpdate: '2027-01-14T09:00:00.000Z', timestamp: 1799900000 },
  { version: '16.28.1', lastUpdate: '2027-01-28T09:00:00.000Z', timestamp: 1801100000 },
]

/** A `version.json` as the dump would serve it right after `version` landed. */
function versionAt(version: string) {
  const index = HISTORY.findIndex((entry) => entry.version === version)
  const current = HISTORY[index]
  if (!current) throw new Error(`unknown patch ${version}`)

  return {
    version: current.version,
    lastUpdate: current.lastUpdate,
    timestamp: current.timestamp,
    history: HISTORY.slice(0, index + 1),
  }
}

const championBody = (names: Record<number, string>) => ({
  version: '16.23.1',
  locale: 'en_US',
  champions: Object.entries(names).map(([id, name]) => ({
    id: Number(id),
    name,
    slug: name.toLowerCase(),
    iconUrl: `https://raw.communitydragon.org/16.23/v1/champion-icons/${id}.png`,
    positions: ['MIDDLE'],
    roles: ['MAGE'],
  })),
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/** A dump whose two answers the test can change between refreshes, and whose calls it can count. */
function stubDump() {
  const state = {
    calls: { version: 0, champions: 0 },
    version: (() => json(versionAt('16.23.1'))) as () => Response,
    champions: (() => json(championBody({ 1: 'Annie', 266: 'Aatrox' }))) as () => Response,
  }

  const fetch: FetchLike = async (url) => {
    if (url.endsWith('/version.json')) {
      state.calls.version += 1
      return state.version()
    }
    state.calls.champions += 1
    return state.champions()
  }

  return { state, client: createHexserveClient({ baseUrl: 'https://dump.test', fetch }) }
}

const refresh = (client: ReturnType<typeof stubDump>['client']) =>
  refreshChampions({ db: ctx.db, client, locale: 'en_US' })

async function storedPatches(): Promise<string[]> {
  const rows = await ctx.db
    .select({ patch: championPatches.patch })
    .from(championPatches)
    .orderBy(asc(championPatches.publishedAtTimestamp))
  return rows.map((row) => row.patch)
}

describe('refreshChampions', () => {
  test('stores the patch, its publication facts, and one row per champion', async () => {
    const { client } = stubDump()
    const result = await refresh(client)

    expect(result.dumpVersion).toBe('16.23.1')
    expect(await storedPatches()).toEqual(['16.23.1'])

    const [patch] = await ctx.db.select().from(championPatches)
    expect(patch?.publishedAt.toISOString()).toBe('2026-11-19T18:40:23.358Z')
    expect(patch?.publishedAtTimestamp).toBe(1795113623)

    const rows = await ctx.db.select().from(champions).where(eq(champions.patch, '16.23.1'))
    // code-unit order, not alphabetical in the colloquial sense: 'Aatrox' before 'Annie'
    expect(rows.map((row) => row.name).sort()).toEqual(['Aatrox', 'Annie'])
    expect(championCacheState(await storedPatches(), result.dumpVersion)).toBe('current')
  })

  test('a poll that finds the patch we already hold fetches no champions at all', async () => {
    const { state, client } = stubDump()
    await refresh(client)

    expect(state.calls.version).toBe(1)
    expect(state.calls.champions).toBe(0)
  })

  test('a new patch is added and the oldest is pruned: exactly two are kept', async () => {
    const { state, client } = stubDump()
    state.version = () => json(versionAt('16.24.1'))
    state.champions = () => json(championBody({ 1: 'Annie', 517: 'Sylas' }))

    const result = await refresh(client)

    expect(await storedPatches()).toEqual(['16.23.1', '16.24.1'])
    expect(championCacheState(await storedPatches(), result.dumpVersion)).toBe('current')

    // the newer patch's own labels, and the older patch's rows are untouched by the prune
    const newest = await ctx.db.select().from(champions).where(eq(champions.patch, '16.24.1'))
    expect(newest.map((row) => row.name).sort()).toEqual(['Annie', 'Sylas'])
    expect(
      await ctx.db.select().from(champions).where(eq(champions.patch, '16.23.1')),
    ).toHaveLength(2)
  })

  test('a third patch deletes the oldest and keeps exactly two (§4)', async () => {
    const { state, client } = stubDump()
    state.version = () => json(versionAt('16.25.1'))

    await refresh(client)

    expect(await storedPatches()).toEqual(['16.24.1', '16.25.1'])
    // the pruned patch's labels went with it — the cascade, not a second delete to forget
    expect(
      await ctx.db.select().from(champions).where(eq(champions.patch, '16.23.1')),
    ).toHaveLength(0)
    // two patches × two labels: the ceiling is on patches, not a row count to hardcode
    expect(await ctx.db.select().from(champions)).toHaveLength(4)
  })

  test('an unreachable dump keeps what we have and reports no version', async () => {
    const { state, client } = stubDump()
    state.version = () => json({ message: 'maintenance' }, 503)

    const result = await refresh(client)

    expect(result.dumpVersion).toBeNull()
    expect(await storedPatches()).toEqual(['16.24.1', '16.25.1'])
    expect(championCacheState(await storedPatches(), result.dumpVersion)).toBe('previous')
  })

  test('a malformed champion index leaves both stored patches intact', async () => {
    const { state, client } = stubDump()
    state.version = () => json(versionAt('16.26.1'))
    state.champions = () => new Response('<html>502</html>', { status: 502 })
    const labelsBefore = await ctx.db.select().from(champions)

    const result = await refresh(client)

    // the dump admitted a new patch, but we could not read it: the two we hold stay, row for row
    expect(result.dumpVersion).toBe('16.26.1')
    expect(await storedPatches()).toEqual(['16.24.1', '16.25.1'])
    expect(await ctx.db.select().from(champions)).toHaveLength(labelsBefore.length)
  })

  /**
   * An empty champion list is indistinguishable from "the dump published a half-written file".
   * Storing it would leave a patch row whose labels resolve to nothing — the blank page this
   * design exists to prevent — so it is treated as a failed fetch.
   */
  test('an empty champion list is a failed fetch, not a patch with no champions', async () => {
    const { state, client } = stubDump()
    state.version = () => json(versionAt('16.27.1'))
    state.champions = () => json({ version: '16.27.1', locale: 'en_US', champions: [] })

    await refresh(client)

    expect(await storedPatches()).toEqual(['16.24.1', '16.25.1'])
  })

  test('two requests on patch day do not collide — one wins, neither throws', async () => {
    const { state, client } = stubDump()
    state.version = () => json(versionAt('16.28.1'))

    const results = await Promise.all([refresh(client), refresh(client)])

    expect(results.map((result) => result.dumpVersion)).toEqual(['16.28.1', '16.28.1'])
    // two patches is a **ceiling**, not a promise: the history named 16.23.1 as the previous one
    // and we pruned it two refreshes ago, so a jump leaves the newest alone. Re-fetching an old
    // patch to fill the second slot would be archive behaviour (§8).
    expect(await storedPatches()).toEqual(['16.28.1'])
    expect(
      await ctx.db.select().from(champions).where(eq(champions.patch, '16.28.1')),
    ).toHaveLength(2)
  })
})
