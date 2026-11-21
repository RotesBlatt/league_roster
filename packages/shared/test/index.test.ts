import { describe, expect, test } from 'bun:test'
import {
  canManageTeam,
  DISPLAY_NAME_MAX,
  isValidBirthday,
  MEMBER_STATUSES,
  missingProfileFields,
  ROLE_LABELS,
  ROLES,
  TIERS,
  USER_ROLES,
} from '../src/index.ts'

describe('canManageTeam', () => {
  test('only an active captain may manage the team', () => {
    expect(canManageTeam({ role: 'captain', status: 'active' })).toBe(true)
  })

  test('a disabled captain cannot manage the team', () => {
    expect(canManageTeam({ role: 'captain', status: 'disabled' })).toBe(false)
  })

  test('a disabled captain cannot manage the team', () => {
    expect(canManageTeam({ role: 'captain', status: 'disabled' })).toBe(false)
  })

  test('a regular member cannot manage the team', () => {
    expect(canManageTeam({ role: 'member', status: 'active' })).toBe(false)
  })

  test('no user at all cannot manage the team', () => {
    expect(canManageTeam(null)).toBe(false)
  })
})

describe('role constants', () => {
  test('every role has a label', () => {
    for (const role of ROLES) {
      expect(ROLE_LABELS[role].length).toBeGreaterThan(0)
    }
  })

  test('roles are unique', () => {
    expect(new Set(ROLES).size).toBe(ROLES.length)
  })

  test('statuses and user roles are the expected sets', () => {
    expect([...MEMBER_STATUSES]).toEqual(['active', 'disabled'])
    expect([...USER_ROLES]).toEqual(['captain', 'member'])
  })

  test('tiers are ordered lowest to highest (Riot API order)', () => {
    expect(TIERS[0]).toBe('IRON')
    expect(TIERS[TIERS.length - 1]).toBe('CHALLENGER')
  })
})

/** A profile with everything filled in; each test removes exactly one thing. */
const complete = {
  displayName: 'Julius',
  preferredRole: 'MID' as const,
  accountCount: 2,
}

describe('missingProfileFields', () => {
  test('a profile that has nothing yet misses every field, in a stable order', () => {
    expect(
      missingProfileFields({ displayName: null, preferredRole: null, accountCount: 0 }),
    ).toEqual(['displayName', 'preferredRole', 'riotAccount'])
  })

  test('a complete profile misses nothing', () => {
    expect(missingProfileFields(complete)).toEqual([])
  })

  test('one account is enough', () => {
    expect(missingProfileFields({ ...complete, accountCount: 1 })).toEqual([])
  })

  test('each field is reported on its own', () => {
    expect(missingProfileFields({ ...complete, displayName: null })).toEqual(['displayName'])
    expect(missingProfileFields({ ...complete, preferredRole: null })).toEqual(['preferredRole'])
    expect(missingProfileFields({ ...complete, accountCount: 0 })).toEqual(['riotAccount'])
  })

  test('a birthday is not required — declining to share it is allowed', () => {
    // Deliberately not part of ProfileState: a rule that could ask for it would nag forever.
    // `isValidBirthday` still guards a value that *is* given.
    expect(missingProfileFields(complete)).toEqual([])
  })

  test('a blank display name counts as missing, not as a name', () => {
    expect(missingProfileFields({ ...complete, displayName: '   ' })).toEqual(['displayName'])
  })

  test('the display name limit is the one the API validates against', () => {
    expect(DISPLAY_NAME_MAX).toBe(40)
    expect(missingProfileFields({ ...complete, displayName: 'x'.repeat(41) })).toEqual([
      'displayName',
    ])
  })
})

describe('isValidBirthday', () => {
  const today = '2026-02-01'

  test('a past calendar date is valid', () => {
    expect(isValidBirthday('2001-07-14', today)).toBe(true)
  })

  test('today is not in the future', () => {
    expect(isValidBirthday(today, today)).toBe(true)
  })

  test('empty means "not filled in", which is not a valid date', () => {
    expect(isValidBirthday('', today)).toBe(false)
  })

  test('the German display format is not an accepted input format', () => {
    expect(isValidBirthday('14.07.2001', today)).toBe(false)
  })

  test('a date that does not exist on the calendar is rejected', () => {
    expect(isValidBirthday('2001-02-30', today)).toBe(false)
    expect(isValidBirthday('2001-13-01', today)).toBe(false)
  })

  test('a leap day is only valid in a leap year', () => {
    expect(isValidBirthday('2004-02-29', today)).toBe(true)
    expect(isValidBirthday('2003-02-29', today)).toBe(false)
  })

  test('a birthday in the future is rejected', () => {
    expect(isValidBirthday('2027-01-01', today)).toBe(false)
  })

  test('dates before 1900 are treated as typos', () => {
    expect(isValidBirthday('1899-12-31', today)).toBe(false)
    expect(isValidBirthday('1900-01-01', today)).toBe(true)
  })
})
