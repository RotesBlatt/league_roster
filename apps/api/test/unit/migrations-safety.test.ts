import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A migration runs against state we do not own: a database that already has rows.
 * These rules catch the shapes that only work on an empty one — the incident in
 * docs/ideas/done/migration-safety.md (ADD COLUMN … NOT NULL, no default).
 *
 * Static, so it costs milliseconds and runs in `bun run test`; nobody has to remember
 * the rule at review time.
 */

type Statement = { file: string; sql: string }
type Problem = { file: string; rule: string; sql: string }

/** Statements shipped before the rule existed; prod is already past them. */
const ALLOWLIST: { file: string; match: string; reason: string }[] = [
  {
    file: '0001_flippant_scorpion.sql',
    match: 'ALTER TABLE "invite" ADD COLUMN "teamId" text NOT NULL',
    reason: 'historical: written before the rule; every live database is past 0001',
  },
  {
    file: '0001_flippant_scorpion.sql',
    match: 'ALTER TABLE "player" ADD COLUMN "teamId" text NOT NULL',
    reason: 'historical: written before the rule; every live database is past 0001',
  },
  {
    file: '0001_flippant_scorpion.sql',
    match: 'ALTER TABLE "user" DROP COLUMN "role"',
    reason: 'historical: replaced by membership.role; allowlisted before the rule',
  },
  {
    file: '0001_flippant_scorpion.sql',
    match: 'ALTER TABLE "user" DROP COLUMN "status"',
    reason: 'historical: replaced by membership.status; allowlisted before the rule',
  },
  {
    file: '0007_open_stepford_cuckoos.sql',
    match: 'DROP TABLE "player"',
    reason:
      'the demo-era roster row: replaced by roster_entry in 0006, which deliberately carried over ' +
      'only rows that belonged to a member. Dropping it is the point, not an accident',
  },
  {
    file: '0002_needy_puma.sql',
    match: 'ALTER TABLE "membership" ADD COLUMN "updatedAt" timestamp with time zone NOT NULL',
    reason: 'historical: written before the rule; every live database is past 0002',
  },
]

// Comments are not SQL: a `-- why` above the DELETE must not hide it from the rules.
const normalize = (sql: string) =>
  sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Pure: the rules, so they are testable without touching the real migration files. */
function problemsIn(file: string, statements: string[]): Problem[] {
  const problems: Problem[] = []
  const normalized = statements.map(normalize)

  normalized.forEach((sql, index) => {
    const addColumn = sql.match(/^ALTER TABLE "?\w+"? ADD COLUMN (?:IF NOT EXISTS )?/i)
    if (addColumn && /\bNOT NULL\b/i.test(sql) && !/\bDEFAULT\b/i.test(sql)) {
      problems.push({ file, rule: 'ADD COLUMN … NOT NULL needs a DEFAULT', sql })
    }

    const setNotNull = sql.match(/^ALTER TABLE "?(\w+)"? ALTER COLUMN "?\w+"? SET NOT NULL/i)
    if (setNotNull) {
      const table = setNotNull[1]
      // A DELETE of the rows that held nulls is just as valid as an UPDATE: both leave the
      // column with no null behind. The pattern is table-scoped on purpose — deleting from
      // another table clears nothing here.
      const cleared = normalized
        .slice(0, index)
        .some((earlier) => new RegExp(`^(?:UPDATE|DELETE FROM) "?${table}"? `, 'i').test(earlier))
      if (!cleared) {
        problems.push({
          file,
          rule: 'SET NOT NULL needs a preceding UPDATE or DELETE in the file',
          sql,
        })
      }
    }

    if (/^(?:ALTER TABLE "?\w+"? )?DROP COLUMN\b/i.test(sql) || /^DROP TABLE\b/i.test(sql)) {
      problems.push({ file, rule: 'dropping data is a decision, not a line of SQL', sql })
    }
  })

  return problems
}

function migrationFiles(): Statement[] {
  const folder = join(import.meta.dir, '../../drizzle')
  return readdirSync(folder)
    .filter((name) => name.endsWith('.sql'))
    .flatMap((file) => {
      const content = readFileSync(join(folder, file), 'utf8')
      return content
        .split('--> statement-breakpoint')
        .map(normalize)
        .filter(Boolean)
        .map((sql) => ({ file, sql }))
    })
}

function problemsAmong(files: Statement[]): Problem[] {
  const byFile = new Map<string, string[]>()
  for (const { file, sql } of files) {
    byFile.set(file, [...(byFile.get(file) ?? []), sql])
  }
  return [...byFile].flatMap(([file, statements]) => problemsIn(file, statements))
}

describe('migration safety rules', () => {
  test('flags a NOT NULL column with no value for existing rows', () => {
    expect(problemsIn('x.sql', ['ALTER TABLE "invite" ADD COLUMN "teamId" text NOT NULL'])).toEqual(
      [
        {
          file: 'x.sql',
          rule: 'ADD COLUMN … NOT NULL needs a DEFAULT',
          sql: 'ALTER TABLE "invite" ADD COLUMN "teamId" text NOT NULL',
        },
      ],
    )
  })

  test('accepts a NOT NULL column that carries a default', () => {
    expect(
      problemsIn('x.sql', ['ALTER TABLE "team" ADD COLUMN "shortName" text NOT NULL DEFAULT \'\'']),
    ).toEqual([])
  })

  test('accepts a nullable column', () => {
    expect(problemsIn('x.sql', ['ALTER TABLE "team" ADD COLUMN "shortName" text'])).toEqual([])
  })

  test('flags SET NOT NULL without a preceding UPDATE or DELETE in the file', () => {
    const problems = problemsIn('x.sql', [
      'ALTER TABLE "invite" ADD COLUMN "teamId" text',
      'ALTER TABLE "invite" ALTER COLUMN "teamId" SET NOT NULL',
    ])
    expect(problems.map((p) => p.rule)).toEqual([
      'SET NOT NULL needs a preceding UPDATE or DELETE in the file',
    ])
  })

  test('accepts SET NOT NULL after the column was backfilled', () => {
    expect(
      problemsIn('x.sql', [
        'ALTER TABLE "invite" ADD COLUMN "teamId" text',
        'UPDATE "invite" SET "teamId" = \'legacy\'',
        'ALTER TABLE "invite" ALTER COLUMN "teamId" SET NOT NULL',
      ]),
    ).toEqual([])
  })

  test('accepts SET NOT NULL after the rows that had nulls were deleted', () => {
    expect(
      problemsIn('x.sql', [
        'DELETE FROM "riot_account" WHERE "puuid" IS NULL',
        'ALTER TABLE "riot_account" ALTER COLUMN "puuid" SET NOT NULL',
      ]),
    ).toEqual([])
  })

  test('a comment above the backfill does not hide it', () => {
    expect(
      problemsIn('x.sql', [
        '-- these rows cannot get a value\nDELETE FROM "riot_account" WHERE "puuid" IS NULL',
        'ALTER TABLE "riot_account" ALTER COLUMN "puuid" SET NOT NULL',
      ]),
    ).toEqual([])
  })

  test('a DELETE on another table clears nothing — the rule stays table-scoped', () => {
    expect(
      problemsIn('x.sql', [
        'DELETE FROM "invite" WHERE true',
        'ALTER TABLE "riot_account" ALTER COLUMN "puuid" SET NOT NULL',
      ]).map((problem) => problem.rule),
    ).toEqual(['SET NOT NULL needs a preceding UPDATE or DELETE in the file'])
  })

  test('flags dropping a column or a table', () => {
    expect(problemsIn('x.sql', ['ALTER TABLE "user" DROP COLUMN "role"'])).toHaveLength(1)
    expect(problemsIn('x.sql', ['DROP TABLE "player"'])).toHaveLength(1)
  })
})

describe('the migration files in the tree', () => {
  test('contain no shape that can only work on an empty database', () => {
    const allowed = (p: Problem) =>
      ALLOWLIST.some((entry) => entry.file === p.file && p.sql.includes(entry.match))

    const unallowed = problemsAmong(migrationFiles()).filter((p) => !allowed(p))
    expect({ file: unallowed[0]?.file, rule: unallowed[0]?.rule, sql: unallowed[0]?.sql }).toEqual({
      file: undefined,
      rule: undefined,
      sql: undefined,
    })
  })

  test('have no stale allowlist entry (one that matches nothing)', () => {
    const files = migrationFiles()
    const stale = ALLOWLIST.filter(
      (entry) => !files.some((f) => f.file === entry.file && f.sql.includes(entry.match)),
    ).map((entry) => entry.match)
    expect(stale).toEqual([])
  })
})
