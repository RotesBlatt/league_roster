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
