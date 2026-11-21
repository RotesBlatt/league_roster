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
  toRiotAccountDto,
} from '../lib/riot-accounts.ts'
import type { AuthPlugin } from '../plugins/auth.ts'

const accountBody = t.Object({
  gameName: t.String({ maxLength: RIOT_GAME_NAME_MAX }),
  tagLine: t.String({ maxLength: RIOT_TAG_LINE_MAX }),
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
                ...values,
                // the first account is the main one; switching is its own endpoint
                isMain: (existing?.value ?? 0) === 0,
                createdAt: new Date(),
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
