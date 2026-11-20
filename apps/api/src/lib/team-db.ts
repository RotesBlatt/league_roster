import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import { and, eq, type SQL } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { Db } from '../db/index.ts'
import type { TeamRow } from './teams.ts'

/**
 * The tenant handle from multi-team.md §5: "every query takes `teamId`" becomes structural.
 * A route that is handed a `TeamDb` cannot write a query without the team predicate, because
 * the raw `Db` is not passed in — forgetting the `WHERE` stops being possible instead of
 * being caught in review.
 */

/** A table that belongs to exactly one team. `id` is needed only to report deletions. */
export type TeamScoped = PgTable & { teamId: PgColumn; id: PgColumn }

/**
 * `teamId` is injected by the scope, so it is not part of any input.
 *
 * `Omit` on an unresolved generic does not distribute over drizzle's conditional insert model —
 * it collapses to a shape where the table's own columns are unknown, so the caller loses type
 * help for `displayName`, `role`, … The `T extends unknown` makes it resolve first.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type TeamInsert<T extends TeamScoped> = DistributiveOmit<InferInsertModel<T>, 'teamId'>

export type TeamDb = {
  readonly team: TeamRow
  selectFrom<T extends TeamScoped>(
    table: T,
    filter?: SQL,
    options?: { orderBy?: (SQL | PgColumn)[] },
  ): Promise<InferSelectModel<T>[]>
  insertInto<T extends TeamScoped>(
    table: T,
    values: TeamInsert<T>,
  ): Promise<InferSelectModel<T> | undefined>
  update<T extends TeamScoped>(
    table: T,
    values: Partial<TeamInsert<T>>,
    filter?: SQL,
  ): Promise<InferSelectModel<T>[]>
  deleteFrom<T extends TeamScoped>(table: T, filter?: SQL): Promise<InferSelectModel<T>[]>
}

export function forTeam(db: Db, team: TeamRow): TeamDb {
  /** the team predicate, ANDed with whatever the caller narrowed by */
  const scoped = (table: TeamScoped, filter?: SQL): SQL =>
    filter ? and(eq(table.teamId, team.id), filter)! : eq(table.teamId, team.id)

  /**
   * Drizzle's builders refuse a *generic* table (`TableLikeHasEmptySelection<T>` is conditional),
   * while every real call site passes a concrete one. This is the single place that pays for it.
   */
  const asTable = (table: TeamScoped): PgTable => table as PgTable

  return {
    team,

    async selectFrom(table, filter, options) {
      const query = db.select().from(asTable(table)).where(scoped(table, filter))
      const ordered = options?.orderBy ? query.orderBy(...options.orderBy) : query
      // drizzle cannot carry a *generic* table through its builder types; the bound is
      // `TeamScoped`, and every call site passes a concrete table, so the shape is sound
      return (await ordered) as InferSelectModel<typeof table>[]
    },

    async insertInto(table, values) {
      const [row] = await db
        .insert(asTable(table))
        .values({ ...values, teamId: team.id } as never)
        .returning()
      return row as InferSelectModel<typeof table> | undefined
    },

    async update(table, values, filter) {
      const rows = await db
        .update(asTable(table))
        .set(values as never)
        .where(scoped(table, filter))
        .returning()
      return rows as InferSelectModel<typeof table>[]
    },

    async deleteFrom(table, filter) {
      const rows = await db.delete(asTable(table)).where(scoped(table, filter)).returning()
      return rows as InferSelectModel<typeof table>[]
    },
  }
}
