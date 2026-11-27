/**
 * A value list that can be pasted into SQL: `('captain', 'member')`.
 *
 * Why a string and not a `sql` fragment: a schema `check()` ends up **in a migration file**, and
 * drizzle-kit renders the expression as DDL — there is no statement to bind a parameter to, so
 * `$1, $2` would be shipped as literal text. The list has to be quoted here or it cannot work.
 *
 * Why generated from the shared array: the alternative is typing the roles out a second time
 * (quick-wins.md B2's trap). A `CHECK` that disagrees with the TS union is worse than none — it
 * rejects a value the application happily writes.
 */
export function sqlStringList(values: readonly string[]): string {
  if (values.length === 0) {
    // `in ()` is a syntax error, and an empty enum is a bug: catching it here names the bug
    throw new Error('sqlStringList needs at least one value: `in ()` is not valid SQL')
  }
  // single quotes are doubled, not escaped with a backslash: `standard_conforming_strings` is on
  // by default, so a backslash is literal and would silently change the value
  return `(${values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ')})`
}

/**
 * The numeric twin of `sqlStringList`, for a vocabulary whose values are numbers rather than names
 * — Riot's `side` is `100`/`200`, and `MATCH_SIDES` in `@lol/shared` is the one place that is
 * written down (§5). A `CHECK (side in (100, 200))` typed out here a second time is the same drift
 * risk D1 describes, with the same silent failure mode: the union and the constraint disagree and
 * only a raw writer finds out.
 *
 * Bare literals, no quotes: the column is an `integer`, and `in ('100')` would work by implicit cast
 * while lying about the type to the next reader of the migration.
 */
export function sqlNumberList(values: readonly number[]): string {
  if (values.length === 0) {
    throw new Error('sqlNumberList needs at least one value: `in ()` is not valid SQL')
  }
  for (const value of values) {
    // `NaN`/`Infinity` render as unquoted words and would be parsed as identifiers or rejected by
    // the parser with a message about the migration, not about the enum.
    if (!Number.isInteger(value)) {
      throw new Error(`sqlNumberList got ${value}, which is not an integer and cannot be a literal`)
    }
  }
  return `(${values.join(', ')})`
}
