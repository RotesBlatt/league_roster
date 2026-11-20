import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { Db } from '../../src/db/index.ts'
import { createTestContext, migrateTo, migrationsFolder } from './helpers.ts'

/**
 * A migration runs against state we do not own: tables that already hold live rows.
 * "It migrated a fresh database" is not evidence — a fresh database is the one case
 * production never is (docs/ideas/engineering/migration-safety.md).
 *
 * For every step, the prefix is applied, one row is put into *every* table that exists
 * at that point, and the remaining migrations run. Any new NOT NULL column, unique
 * index or foreign key that cannot cope with rows fails here, not in prod.
 *
 * 0001/0002 predate this harness and are known not to replay against rows, so the first
 * tested step is the one after them. Every migration added from 0003 on is covered
 * automatically — no list to maintain.
 */
const FIRST_SEEDED_STEP = 3

type Column = {
  table_name: string
  column_name: string
  data_type: string
  is_identity: string
  is_generated: string
}

type SeededRow = { table: string; key: { column: string; value: string }[] }

const tableRef = (table: string) => sql`${sql.identifier('public')}.${sql.identifier(table)}`

/**
 * A value that satisfies any column type in this schema. Passed as a parameter, so
 * Postgres casts it to the column it lands in.
 */
function seedValue(dataType: string): unknown {
  switch (dataType) {
    case 'boolean':
      return false
    case 'smallint':
    case 'integer':
    case 'bigint':
    case 'numeric':
    case 'real':
    case 'double precision':
      return 0
    case 'uuid':
      return '00000000-0000-0000-0000-000000000000'
    case 'json':
    case 'jsonb':
      return '{}'
    case 'date':
    case 'timestamp with time zone':
    case 'timestamp without time zone':
      return new Date().toISOString()
    default:
      return 'seed'
  }
}

/** Puts one row in every public table, without needing a fixture per migration. */
async function seedEveryTable(db: Db): Promise<SeededRow[]> {
  const columns = Array.from(
    await db.execute(sql`
      select table_name, column_name, data_type, is_identity, is_generated
      from information_schema.columns
      where table_schema = 'public'
      order by table_name, ordinal_position
    `),
  ) as unknown as Column[]

  const tables = new Map<string, Column[]>()
  for (const column of columns) {
    tables.set(column.table_name, [...(tables.get(column.table_name) ?? []), column])
  }

  // a seeded row may point at a table seeded later; foreign keys must not care
  for (const table of tables.keys()) {
    await db.execute(sql`ALTER TABLE ${tableRef(table)} DISABLE TRIGGER ALL`)
  }

  for (const [table, tableColumns] of tables) {
    const writable = tableColumns.filter(
      (column) => column.is_identity !== 'YES' && column.is_generated !== 'YES',
    )
    const names = sql.join(
      writable.map((column) => sql.identifier(column.column_name)),
      sql`, `,
    )
    const values = sql.join(
      writable.map((column) => sql`${seedValue(column.data_type)}`),
      sql`, `,
    )
    await db.execute(sql`INSERT INTO ${tableRef(table)} (${names}) VALUES (${values})`)
  }

  for (const table of tables.keys()) {
    await db.execute(sql`ALTER TABLE ${tableRef(table)} ENABLE TRIGGER ALL`)
  }

  return seededRows(db)
}

/** The primary key of the one seeded row per table, used to prove it is still there. */
async function seededRows(db: Db): Promise<SeededRow[]> {
  const keys = Array.from(
    await db.execute(sql`
      select tc.table_name, kcu.column_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name
        and kcu.table_schema = tc.table_schema
      where tc.table_schema = 'public' and tc.constraint_type = 'PRIMARY KEY'
      order by tc.table_name, kcu.ordinal_position
    `),
  ) as unknown as { table_name: string; column_name: string }[]

  const byTable = new Map<string, string[]>()
  for (const { table_name, column_name } of keys) {
    byTable.set(table_name, [...(byTable.get(table_name) ?? []), column_name])
  }

  const seeded: SeededRow[] = []
  for (const [table, columns] of byTable) {
    const selection = sql.join(
      columns.map((column) => sql.identifier(column)),
      sql`, `,
    )
    const [row] = Array.from(
      await db.execute(sql`SELECT ${selection} FROM ${tableRef(table)}`),
    ) as unknown as Record<string, unknown>[]
    if (!row) continue
    seeded.push({ table, key: columns.map((column) => ({ column, value: String(row[column]) })) })
  }
  return seeded
}

async function expectRowsSurvive(db: Db, seeded: SeededRow[]): Promise<void> {
  for (const { table, key } of seeded) {
    const [presence] = Array.from(
      await db.execute(sql`select to_regclass(${`public.${table}`}) is not null as present`),
    ) as unknown as { present: boolean }[]
    // a dropped table is a decision the static test already forces into an allowlist
    if (!presence?.present) continue

    const condition = sql.join(
      key.map(({ column, value }) => sql`${sql.identifier(column)}::text = ${value}`),
      sql` and `,
    )
    const [found] = Array.from(
      await db.execute(
        sql`select count(*)::int as rows from ${tableRef(table)} where ${condition}`,
      ),
    ) as unknown as { rows: number }[]
    expect(found?.rows ?? 0, `${table} lost the row it had before the migration`).toBeGreaterThan(0)
  }
}

const migrations = readMigrationFiles({ migrationsFolder })
const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8')) as {
  entries: { tag: string }[]
}

describe('a migration applied to a database that already has rows', () => {
  for (let step = FIRST_SEEDED_STEP; step < migrations.length; step += 1) {
    const tag = journal.entries[step]?.tag ?? `#${step + 1}`

    test(`${tag} keeps the rows seeded at ${step}`, async () => {
      const ctx = await createTestContext({ migrate: false })
      try {
        await migrateTo(ctx.db, step)
        const seeded = await seedEveryTable(ctx.db)
        await migrate(ctx.db, { migrationsFolder })
        await expectRowsSurvive(ctx.db, seeded)
      } finally {
        await ctx.drop()
      }
    })
  }
})
