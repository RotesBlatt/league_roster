import { describe, expect, test } from 'bun:test'
import { DIVISIONS, MEMBER_STATUSES, QUEUES, ROLES, TIERS, USER_ROLES } from '@lol/shared'
import { sqlStringList } from '../../src/db/enum-list.ts'

/**
 * A `CHECK (col IN (…))` needs its value list as *literal* SQL: drizzle-kit writes a schema
 * expression into a migration file, and a bound parameter is not SQL there. So the list is built
 * from the shared enum array rather than typed out again (quick-wins.md D1) — the same trap as
 * B2, where a hand-written CASE drifted from `ROLES` because nobody re-reads it.
 *
 * Pure on purpose: this is the one test that can prove "generated from the enum" without a
 * database, and it is the reason the migration's list and the TS union cannot disagree.
 */
describe('a SQL string list, built from an enum array', () => {
  test('renders one quoted literal per value, in the order given', () => {
    expect(sqlStringList(USER_ROLES)).toBe("('captain', 'member')")
  })

  test('a single value is still parenthesised, so `in (…)` stays valid', () => {
    // the empty case cannot arise from a real enum, but a one-element list is one typo away
    expect(sqlStringList(['only'])).toBe("('only')")
  })

  test('an empty enum is refused, because `in ()` is a syntax error, not an empty set', () => {
    expect(() => sqlStringList([])).toThrow()
  })

  test('a quote is doubled, so a value cannot end the literal early', () => {
    // no shared enum holds one today; the helper must not depend on that staying true
    expect(sqlStringList(["can't"])).toBe("('can''t')")
  })
})

describe('the lists the CHECKs will use', () => {
  // asserts the *source*: whatever these arrays say is what the migration says, so this test
  // documenting the four is what makes "one edit in @lol/shared" true rather than aspirational
  test('cover the four vocabularies the enums column types guard', () => {
    expect(sqlStringList(ROLES)).toBe("('TOP', 'JGL', 'MID', 'ADC', 'SUP')")
    expect(sqlStringList(MEMBER_STATUSES)).toBe("('active', 'disabled')")
    expect(sqlStringList(TIERS)).toContain("'GOLD'")
    expect(sqlStringList(DIVISIONS)).toBe("('I', 'II', 'III', 'IV')")
  })

  test('QUEUES is not a column list — it orders badges, nothing stores it', () => {
    // a reminder next to the others: adding a CHECK for it would invent a column that does not exist
    expect(QUEUES.every((queue) => typeof queue === 'string')).toBe(true)
  })
})
