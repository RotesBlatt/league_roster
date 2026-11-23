import type { PatchHistoryEntry } from '@lol/shared'

/**
 * The only module that speaks to the Hexserve dump (hexserve-champion-data.md §2, §7).
 *
 * It is DDragon-shaped but ours: `/version.json` says which patch is current, `/<patch>/<locale>/
 * champion-index.json` says what the champions are called. Nothing else is read — full stats and
 * items exist and are deliberately unused (§8).
 *
 * "Degrade, never block" is enforced here, once: every failure (unreachable host, non-2xx, a
 * maintenance page instead of JSON, a body of the wrong shape, a hung socket) is `null`, never a
 * throw. The dump is a hobby host we also run, and a label must never be able to fail a page.
 *
 * `fetch` is injected for the same reason `db` and `auth` are: a test must be able to answer 500,
 * hang, or return nonsense without a network call.
 */

export type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<Response>

/** One base URL in one place: the domain is a hobby name and will outlive itself (§9.7). */
export const HEXSERVE_BASE_URL = 'https://hexserve.dump-collector.de'

/** `/version.json` — the answer to "is there a patch we do not hold?" and the history to prune by. */
export type VersionIndex = {
  version: string
  lastUpdate: string
  timestamp: number
  /**
   * Guaranteed to contain `version`: if the dump's history lost the current entry, it is appended,
   * because retention must never prune the patch we are about to store (§5).
   */
  history: PatchHistoryEntry[]
}

/** One champion as we store it. Ids and icons only — base stats stay unread (§8). */
export type ChampionIndexEntry = {
  /** The dump's numeric `id`, which is what Riot's match data references. Not `key` (the name). */
  championId: number
  name: string
  slug: string
  /** Absolute URL on CommunityDragon, stored as given — its major.minor cannot be derived (§2). */
  iconUrl: string
  /** Hints only: never a filter, never a warning colour (§9.5). */
  positions: string[]
  roles: string[]
}

export type HexserveClient = {
  getVersionIndex(): Promise<VersionIndex | null>
  getChampionIndex(patch: string, locale: string): Promise<ChampionIndexEntry[] | null>
}

export type HexserveClientOptions = {
  /** defaults to `HEXSERVE_BASE_URL`; a test or a mirror points elsewhere */
  baseUrl?: string
  /** `globalThis.fetch` in production; a stub in tests. */
  fetch?: FetchLike
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 10_000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0

const isWholeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value)

/** A list of strings, or `[]`: an absent or odd hint list must not cost us the champion. */
function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isText) : []
}

/**
 * A history entry needs `version` and `timestamp` — the two fields retention orders and prunes by.
 * `lastUpdate` is display sugar, so it may be missing without the patch being forgotten.
 */
export function parsePatchHistoryEntry(value: unknown): PatchHistoryEntry | null {
  if (!isRecord(value)) return null

  const { version, lastUpdate, timestamp } = value
  if (!isText(version) || !isWholeNumber(timestamp)) return null

  return { version, lastUpdate: isText(lastUpdate) ? lastUpdate : null, timestamp }
}

/** The current patch must be readable; individual history entries may be dropped (§5). */
export function parseVersionIndex(body: unknown): VersionIndex | null {
  if (!isRecord(body)) return null

  const { version, lastUpdate, timestamp, history } = body
  if (!isText(version) || !isText(lastUpdate) || !isWholeNumber(timestamp)) return null

  const entries = Array.isArray(history)
    ? history.flatMap((entry): PatchHistoryEntry[] => {
        const parsed = parsePatchHistoryEntry(entry)
        return parsed === null ? [] : [parsed]
      })
    : []

  // the current patch is what we are about to store: it has to survive retention even if the
  // history array forgot it
  if (!entries.some((entry) => entry.version === version)) {
    entries.push({ version, lastUpdate, timestamp })
  }

  return { version, lastUpdate, timestamp, history: entries }
}

/** A champion needs an id, a name and an icon to be renderable; absent hints become `[]`. */
export function parseChampionIndexEntry(value: unknown): ChampionIndexEntry | null {
  if (!isRecord(value)) return null

  const { id, name, slug, iconUrl, positions, roles } = value
  if (!isWholeNumber(id) || !isText(name) || !isText(slug) || !isText(iconUrl)) return null

  return {
    championId: id,
    name,
    slug,
    iconUrl,
    positions: textList(positions),
    roles: textList(roles),
  }
}

export function createHexserveClient({
  baseUrl = HEXSERVE_BASE_URL,
  fetch = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: HexserveClientOptions = {}): HexserveClient {
  // a trailing slash in config must not become a `//` in the URL
  const base = baseUrl.replace(/\/+$/, '')

  /** One GET → parsed JSON, or `null`. Nothing here throws (§7). */
  async function getJson(path: string): Promise<unknown | null> {
    let response: Response
    try {
      response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(timeoutMs) })
    } catch {
      // timeout, DNS, reset, maintenance redirect loop: the caller cannot act on the difference
      return null
    }

    if (!response.ok) return null

    try {
      return await response.json()
    } catch {
      // an HTML maintenance page is not a champion list
      return null
    }
  }

  return {
    async getVersionIndex() {
      return parseVersionIndex(await getJson('/version.json'))
    },

    /**
     * `patch` and `locale` come from our own stored values, but they are encoded anyway: a value
     * that reaches a URL should not be able to become a different path.
     */
    async getChampionIndex(patch, locale) {
      const path = `/${encodeURIComponent(patch)}/${encodeURIComponent(locale)}/champion-index.json`
      const body = await getJson(path)
      if (!isRecord(body) || !Array.isArray(body.champions)) return null

      return body.champions.flatMap((entry): ChampionIndexEntry[] => {
        const parsed = parseChampionIndexEntry(entry)
        return parsed === null ? [] : [parsed]
      })
    },
  }
}
