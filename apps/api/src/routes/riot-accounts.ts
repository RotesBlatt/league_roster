import { DEFAULT_RIOT_PLATFORM, isPlatform } from '@lol/shared'
import { and, asc, count, desc, eq, sql } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import type { Db } from '../db/index.ts'
import { riotAccounts } from '../db/schema.ts'
import type { Logger } from '../lib/log/logger.ts'
import { noopLogger } from '../lib/log/noop.ts'
import { uniqueViolation } from '../lib/pg-errors.ts'
import {
  normalizeRiotAccountId,
  RIOT_GAME_NAME_MAX,
  RIOT_TAG_LINE_MAX,
  snapshotFields,
  toRiotAccountDto,
} from '../lib/riot-accounts.ts'
import type { AuthPlugin } from '../plugins/auth.ts'
import type { RiotClient } from '../riot/client.ts'
import type { Throttle } from '../riot/throttle.ts'

const accountBody = t.Object({
  gameName: t.String({ maxLength: RIOT_GAME_NAME_MAX }),
  tagLine: t.String({ maxLength: RIOT_TAG_LINE_MAX }),
  /** Optional so the first-login form keeps working; the default is `euw1`. */
  platform: t.Optional(t.String({ maxLength: 8 })),
})

const RIOT_ID_TAKEN = { message: 'This Riot ID is already on your profile' }
const NOT_FOUND = { message: 'Account not found' }

/** The unique index that guards `(userId, gameName, tagLine)`. */
const RIOT_ID_INDEX = 'riot_account_userId_riot_id_idx'

/**
 * A player's League accounts. Global and player-owned, like the profile next to it: no team in
 * the path, and `{ auth: true }` so a signed-in user with no team can still add one.
 *
 * Two writes need a transaction, not because they are long but because they read-then-write:
 * "is this the first account?" on create, and "was that the main?" on delete. Both take a row
 * lock on the player (`select … for update`) so two simultaneous requests cannot both answer
 * "yes" and end up with two mains.
 */
export function createRiotAccountRoutes(
  db: Db,
  riot: RiotClient,
  throttle: Throttle,
  authPlugin: AuthPlugin,
  requestLogger?: (request: Request) => Logger,
) {
  /** Serialises account writes per player; the lock is released when the transaction ends. */
  const lockPlayer = (tx: Parameters<Parameters<Db['transaction']>[0]>[0], userId: string) =>
    tx.execute(sql`select id from "user" where id = ${userId} for update`)

  return new Elysia({ prefix: '/me/riot-accounts' })
    .use(authPlugin)
    .get(
      '/',
      async ({ me }) => {
        const rows = await db
          .select()
          .from(riotAccounts)
          .where(eq(riotAccounts.userId, me.id))
          // main first, then oldest first: the list is stable, not insertion-random
          .orderBy(desc(riotAccounts.isMain), asc(riotAccounts.createdAt), asc(riotAccounts.id))

        return rows.map(toRiotAccountDto)
      },
      { auth: true },
    )
    .post(
      '/',
      async ({ body, me, status, request }) => {
        const { values, problems } = normalizeRiotAccountId(body)
        if (problems.length > 0) {
          return status(422, {
            message: 'Invalid Riot ID',
            details: problems.map((problem) => ({
              path: problem.field,
              message: problem.message,
            })),
          })
        }

        const platform = body.platform ?? DEFAULT_RIOT_PLATFORM
        if (!isPlatform(platform)) {
          return status(422, {
            message: 'Invalid platform',
            details: [{ path: 'platform', message: 'Unknown platform' }],
          })
        }

        /**
         * The server re-resolves; a client-supplied `puuid` or rank is never read (§5). Our own
         * budget guard runs first, and being throttled skips the lookup instead of refusing the
         * save: a comfort feature must not block onboarding.
         */
        const decision = throttle.take(me.id)
        const result = decision.allowed ? await riot.lookupAccount({ ...values, platform }) : null

        // a Riot ID that provably does not exist is a typo, not an unverified account
        if (result !== null && !result.ok) {
          if (result.error.kind === 'not_found') {
            return status(404, { message: 'No such Riot ID on that platform — check name, tag' })
          }
          if (result.error.kind === 'bad_request') {
            return status(422, { message: 'Riot rejected that Riot ID' })
          }
          // 403 / 429 / timeout / unavailable: degrade, never block (§5)
        }

        // Riot's canonical label wins once it answered, so a rename lands on the next save (§2)
        const label = result?.ok
          ? { gameName: result.account.gameName, tagLine: result.account.tagLine }
          : values
        const now = new Date()
        const snapshot = snapshotFields(result, now)

        let row: typeof riotAccounts.$inferSelect | undefined
        try {
          row = await db.transaction(async (tx) => {
            await lockPlayer(tx, me.id)
            const [existing] = await tx
              .select({ value: count() })
              .from(riotAccounts)
              .where(eq(riotAccounts.userId, me.id))

            const [inserted] = await tx
              .insert(riotAccounts)
              .values({
                id: crypto.randomUUID(),
                // never from the body: an account can only ever belong to its caller
                userId: me.id,
                ...label,
                platform,
                ...snapshot,
                // the first account is the main one; switching is its own endpoint
                isMain: (existing?.value ?? 0) === 0,
                createdAt: now,
              })
              .returning()

            return inserted
          })
        } catch (error) {
          // the DB rule, turned into a sentence instead of a 500
          if (uniqueViolation(error) === RIOT_ID_INDEX) return status(409, RIOT_ID_TAKEN)
          throw error
        }

        if (!row) return status(500, { message: 'Could not add account' })

        const log = requestLogger?.(request) ?? noopLogger
        log.info('riot_account.created', {
          userId: me.id,
          accountId: row.id,
          isMain: row.isMain,
          platform,
          // what the lookup bought, not what the player typed
          verified: snapshot.verifiedAt !== null,
          partial: result?.ok === true && result.partial,
          throttled: !decision.allowed,
          failed: result !== null && !result.ok ? result.error.kind : null,
        })

        return toRiotAccountDto(row)
      },
      { auth: true, body: accountBody },
    )
    .put(
      '/:id/main',
      async ({ params: { id }, me, status, request }) => {
        const result = await db.transaction(async (tx) => {
          await lockPlayer(tx, me.id)

          const [target] = await tx
            .select()
            .from(riotAccounts)
            // the userId predicate is what makes another player's id a 404
            .where(and(eq(riotAccounts.id, id), eq(riotAccounts.userId, me.id)))
            .limit(1)

          if (!target) return undefined
          // already main: nothing to write, and the caller still gets the account back
          if (target.isMain) return target

          // Down before up. A single `set isMain = (id = target)` can trip the partial unique
          // index on row order; two statements inside one transaction cannot leave the player
          // with two mains or, once committed, with none.
          await tx
            .update(riotAccounts)
            .set({ isMain: false })
            .where(and(eq(riotAccounts.userId, me.id), eq(riotAccounts.isMain, true)))

          const [updated] = await tx
            .update(riotAccounts)
            .set({ isMain: true })
            .where(eq(riotAccounts.id, target.id))
            .returning()

          return updated
        })

        if (!result) return status(404, NOT_FOUND)

        const log = requestLogger?.(request) ?? noopLogger
        log.info('riot_account.main_changed', {
          userId: me.id,
          accountId: result.id,
        })

        return toRiotAccountDto(result)
      },
      { auth: true, params: t.Object({ id: t.String() }) },
    )
    .delete(
      '/:id',
      async ({ params: { id }, me, status, request }) => {
        const deleted = await db.transaction(async (tx) => {
          await lockPlayer(tx, me.id)

          // the userId predicate is what makes another player's id a 404, not a delete
          const [row] = await tx
            .delete(riotAccounts)
            .where(and(eq(riotAccounts.id, id), eq(riotAccounts.userId, me.id)))
            .returning()

          if (!row) return undefined

          // deleting the main must not leave accounts without one: promote the oldest left
          if (row.isMain) {
            const [next] = await tx
              .select({ id: riotAccounts.id })
              .from(riotAccounts)
              .where(eq(riotAccounts.userId, me.id))
              .orderBy(asc(riotAccounts.createdAt), asc(riotAccounts.id))
              .limit(1)

            if (next) {
              await tx
                .update(riotAccounts)
                .set({ isMain: true })
                .where(eq(riotAccounts.id, next.id))
            }
          }

          return row
        })

        if (!deleted) return status(404, NOT_FOUND)

        const log = requestLogger?.(request) ?? noopLogger
        log.info('riot_account.deleted', {
          userId: me.id,
          accountId: deleted.id,
          wasMain: deleted.isMain,
        })

        return { ok: true }
      },
      { auth: true, params: t.Object({ id: t.String() }) },
    )
}

export type RiotAccountRoutes = ReturnType<typeof createRiotAccountRoutes>
