import { describe, expect, test } from 'bun:test'
import { uniqueViolation } from '../../src/lib/pg-errors.ts'

/**
 * The one behaviour that matters: a unique violation must be recognisable **through** drizzle's
 * error wrapping, or a duplicate Riot ID becomes a 500.
 */
describe('uniqueViolation', () => {
  test('reads the name from the key postgres.js actually sets', () => {
    // NOT `constraint`: that is the node-postgres spelling and is absent in our driver.
    expect(uniqueViolation({ code: '23505', constraint_name: 'riot_account_one_main_idx' })).toBe(
      'riot_account_one_main_idx',
    )
  })

  test('finds them when drizzle put the driver error on cause', () => {
    const wrapped = new Error('Failed query: insert into riot_account ...', {
      cause: { code: '23505', constraint_name: 'riot_account_userId_riot_id_idx' },
    })

    expect(uniqueViolation(wrapped)).toBe('riot_account_userId_riot_id_idx')
  })

  test('still accepts the node-postgres spelling, so the helper is not driver-locked', () => {
    expect(uniqueViolation({ code: '23505', constraint: 'some_idx' })).toBe('some_idx')
  })

  test('is not fooled by other database errors', () => {
    expect(uniqueViolation({ code: '23502' })).toBeNull()
    expect(uniqueViolation(new Error('socket closed'))).toBeNull()
    expect(uniqueViolation(null)).toBeNull()
    expect(uniqueViolation('boom')).toBeNull()
  })

  test('a unique violation without a named constraint is still recognised', () => {
    expect(uniqueViolation({ code: '23505' })).toBe('')
  })

  test('does not walk a cause cycle forever', () => {
    const a: { code?: string; cause?: unknown } = { cause: undefined }
    const b = { cause: a }
    a.cause = b

    expect(uniqueViolation(a)).toBeNull()
  })
})
