import { notInArray, sql } from 'drizzle-orm'
import type { Db } from '../db/index.ts'
import { championPatches, champions } from '../db/schema.ts'
import type { Logger } from '../lib/log/logger.ts'
import { noopLogger } from '../lib/log/noop.ts'
import type { HexserveClient } from './client.ts'
import { needsRefresh, retainNewestTwo } from './rules.ts'

/**
 * The only writer of the champion cache (hexserve-champion-data.md §5, §7).
 *
 * The shape is `fetch → validate → insert the new patch → prune beyond the two newest → commit`,
 * and each step exists because of a way this goes wrong for a page:
 *
 * - **it runs lazily, on a request**, because the repo has no scheduler and a self-healing read is
 *   cheaper than a timer that can die quietly;
 * - **nothing is written before the dump has been read and understood**, so a 502 cannot empty the
 *   cache and a page never renders every champion as a bare id;
 * - **the write is one transaction**, so a reader during the replace sees either the old pairs or
 *   the new ones, never a half-replaced table;
 * - **pruning goes through the patch parent** (`ON DELETE CASCADE`), so exactly one statement can
 *   drop a patch and its labels together.
 */

/** The locale champion names are fetched in. One column, so another language is a refetch later. */
export const CHAMPION_LOCALE = 'en_US'

/**
 * One key for every refresh attempt, so two page loads on patch day cannot both write. Same
 * pattern as the migration lock, and likewise cluster-wide because the database is the only
 * thing the instances share.
 */
export const REFRESH_LOCK_KEY = 727_002

export type RefreshDeps = {
  db: Db
  client: HexserveClient
  locale?: string
  logger?: Logger
  /** injection point for `fetchedAt`, so a test can pin it */
  now?: () => Date
}

export type RefreshResult = {
  /**
   * What the dump said is current, or `null` when it could not be read. The caller needs it to
   * tell "current" from "previous" — the cache alone cannot know what it is missing (§5).
   */
  dumpVersion: string | null
}

export async function refreshChampions({
  db,
  client,
  locale = CHAMPION_LOCALE,
  logger = noopLogger,
  now = () => new Date(),
}: RefreshDeps): Promise<RefreshResult> {
  const index = await client.getVersionIndex()
  if (index === null) {
    // not an error: our hobby host restarting must not look like a bug, and the rows still serve
    logger.warn('hexserve.unreachable', { hint: 'serving the champion cache we already have' })
    return { dumpVersion: null }
  }

  const stored = await storedPatches(db)
  // the whole of what used to be a patch resolver: one version comparison, never a TTL
  if (!needsRefresh(stored, index.version)) return { dumpVersion: index.version }

  const labels = await client.getChampionIndex(index.version, locale)
  if (labels === null || labels.length === 0) {
    // an empty list is indistinguishable from a half-written publish; storing it would leave a
    // patch that resolves no names at all, which is the blank page this design exists to prevent
    logger.warn('hexserve.refresh_failed', {
      patch: index.version,
      reason: labels === null ? 'unreadable' : 'no champions',
      hint: 'keeping the patches we already hold',
    })
    return { dumpVersion: index.version }
  }

  const keep = retainNewestTwo(index.history)
  const fetchedAt = now()

  await db.transaction(async (tx) => {
    // taken last, and transaction-scoped: the lock is held only for the write, never across the
    // HTTP calls above, so a slow dump cannot occupy a connection
    const [lock] = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(${REFRESH_LOCK_KEY}) as locked`,
    )
    if (!lock?.locked) {
      logger.debug('hexserve.refresh_skipped', { reason: 'another refresh holds the lock' })
      return
    }

    // re-read under the lock: the loser of the race must not insert the same patch row again
    if (!needsRefresh(await storedPatches(tx), index.version)) return

    await tx.insert(championPatches).values({
      patch: index.version,
      publishedAt: new Date(index.lastUpdate),
      publishedAtTimestamp: index.timestamp,
      fetchedAt,
    })

    await tx.insert(champions).values(
      labels.map((label) => ({
        patch: index.version,
        championId: label.championId,
        name: label.name,
        slug: label.slug,
        iconUrl: label.iconUrl,
        positions: label.positions,
        roles: label.roles,
        locale,
      })),
    )

    // anything the dump no longer calls one of the two newest goes, labels included by cascade
    if (keep.length > 0) {
      await tx.delete(championPatches).where(notInArray(championPatches.patch, keep))
    }
  })

  logger.info('hexserve.refreshed', {
    patch: index.version,
    champions: labels.length,
    retained: keep,
  })

  return { dumpVersion: index.version }
}

/**
 * The patches we currently hold. Accepts the transaction handle too, so the check under the lock
 * reads the same thing as the check before it.
 */
async function storedPatches(db: Pick<Db, 'select'>): Promise<string[]> {
  const rows = await db.select({ patch: championPatches.patch }).from(championPatches)
  return rows.map((row) => row.patch)
}
