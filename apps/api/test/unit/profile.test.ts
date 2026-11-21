import { describe, expect, test } from 'bun:test'
import { DISPLAY_NAME_MAX } from '@lol/shared'
import { normalizeProfileInput, parseRole, toProfileDto } from '../../src/lib/profile.ts'

/**
 * The rules a route must not decide for itself (AGENTS: "a route handler that thinks is a route
 * handler that can't be tested"). Pure: no db, no clock — `today` is a parameter.
 */
const today = '2026-02-01'

describe('normalizeProfileInput', () => {
  test('trims the display name and keeps a valid birthday', () => {
    const { values, problems } = normalizeProfileInput(
      { displayName: '  Julius  ', preferredRole: 'MID', birthday: '2001-07-14' },
      today,
    )

    expect(problems).toEqual([])
    expect(values).toEqual({
      displayName: 'Julius',
      preferredRole: 'MID',
      birthday: '2001-07-14',
    })
  })

  test('a blank display name is a field error, not a stored empty string', () => {
    const { problems } = normalizeProfileInput({ displayName: '   ', preferredRole: 'TOP' }, today)

    expect(problems).toEqual([{ field: 'displayName', message: 'Display name is required' }])
  })

  test('a display name longer than the shared limit is refused', () => {
    const { problems } = normalizeProfileInput(
      { displayName: 'x'.repeat(DISPLAY_NAME_MAX + 1), preferredRole: 'TOP' },
      today,
    )

    expect(problems.map((problem) => problem.field)).toEqual(['displayName'])
  })

  test('a display name exactly at the limit passes', () => {
    const { problems } = normalizeProfileInput(
      { displayName: 'x'.repeat(DISPLAY_NAME_MAX), preferredRole: 'TOP' },
      today,
    )

    expect(problems).toEqual([])
  })

  test('an omitted birthday is null, and not a problem — it is personal data', () => {
    for (const birthday of [undefined, null, '', '   ']) {
      const { values, problems } = normalizeProfileInput(
        { displayName: 'Julius', preferredRole: 'MID', birthday },
        today,
      )

      expect(problems).toEqual([])
      expect(values.birthday).toBeNull()
    }
  })

  test('a birthday that is not a real date is a field error', () => {
    for (const birthday of ['14.07.2001', '2001-02-30', 'not a date']) {
      const { values, problems } = normalizeProfileInput(
        { displayName: 'Julius', preferredRole: 'MID', birthday },
        today,
      )

      expect(values.birthday).toBeNull()
      expect(problems).toEqual([{ field: 'birthday', message: 'Birthday is not a valid date' }])
    }
  })

  test('a birthday in the future is refused', () => {
    const { problems } = normalizeProfileInput(
      { displayName: 'Julius', preferredRole: 'MID', birthday: '2026-02-02' },
      today,
    )

    expect(problems.map((problem) => problem.field)).toEqual(['birthday'])
  })

  test('both fields can be wrong at once, and each says its own thing', () => {
    const { problems } = normalizeProfileInput(
      { displayName: '', preferredRole: 'SUP', birthday: '1900-01-01x' },
      today,
    )

    expect(problems.map((problem) => problem.field)).toEqual(['displayName', 'birthday'])
  })
})

describe('parseRole', () => {
  test('accepts every role we know', () => {
    for (const role of ['TOP', 'JGL', 'MID', 'ADC', 'SUP'] as const) {
      expect(parseRole(role)).toBe(role)
    }
  })

  test('rejects anything else, instead of guessing a default', () => {
    // the full Riot name and a lowercase variant are both unknown here
    expect(parseRole('JUNGLE')).toBeNull()
    expect(parseRole('mid')).toBeNull()
    expect(parseRole('')).toBeNull()
  })
})

describe('toProfileDto', () => {
  test('passes the stored fields through and turns the timestamp into epoch ms', () => {
    const dto = toProfileDto({
      displayName: 'Julius',
      preferredRole: 'MID',
      birthday: '2001-07-14',
      updatedAt: new Date('2026-01-02T03:04:05.000Z'),
    })

    expect(dto).toEqual({
      displayName: 'Julius',
      preferredRole: 'MID',
      birthday: '2001-07-14',
      updatedAt: Date.parse('2026-01-02T03:04:05.000Z'),
    })
  })

  test('a missing birthday stays null, not undefined or an empty string', () => {
    const dto = toProfileDto({
      displayName: 'Julius',
      preferredRole: 'MID',
      birthday: null,
      updatedAt: new Date(0),
    })

    expect(dto.birthday).toBeNull()
  })
})
