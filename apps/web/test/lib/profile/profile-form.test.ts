import { describe, expect, test } from 'bun:test'
import { DISPLAY_NAME_MAX } from '@lol/shared'
import {
  draftAccount,
  draftProfile,
  prefillProfile,
  profileChanged,
  todayIso,
} from '../../../src/lib/profile/profile-form.ts'

/**
 * The profile form's thinking, without a DOM: what to send, and what the form starts with.
 * The API stays authoritative — these checks only save a round trip, exactly like
 * `lib/team/writes.ts`.
 */
const today = '2026-02-01'

describe('draftProfile', () => {
  test('trims the name, keeps the role and sends an explicit null birthday', () => {
    expect(
      draftProfile({ displayName: '  Julius ', preferredRole: 'MID', birthday: '' }, today),
    ).toEqual({
      ok: true,
      body: { displayName: 'Julius', preferredRole: 'MID', birthday: null },
    })
  })

  test('sends a chosen birthday as is', () => {
    expect(
      draftProfile({ displayName: 'Julius', preferredRole: 'ADC', birthday: '2001-07-14' }, today),
    ).toEqual({
      ok: true,
      body: { displayName: 'Julius', preferredRole: 'ADC', birthday: '2001-07-14' },
    })
  })

  test('refuses a blank name without asking the API', () => {
    const draft = draftProfile({ displayName: '   ', preferredRole: 'MID', birthday: '' }, today)

    expect(draft).toMatchObject({ ok: false })
    if (!draft.ok) expect(draft.message.toLowerCase()).toContain('display name')
  })

  test('refuses a name the API would reject as too long', () => {
    expect(
      draftProfile(
        { displayName: 'x'.repeat(DISPLAY_NAME_MAX + 1), preferredRole: 'MID', birthday: '' },
        today,
      ),
    ).toMatchObject({ ok: false })
  })

  test('accepts a name exactly at the limit', () => {
    expect(
      draftProfile(
        {
          displayName: 'x'.repeat(DISPLAY_NAME_MAX),
          preferredRole: 'MID',
          birthday: '',
        },
        today,
      ),
    ).toMatchObject({ ok: true })
  })

  test('requires a role — "no preference" is not a stored state', () => {
    const draft = draftProfile({ displayName: 'Julius', preferredRole: null, birthday: '' }, today)

    expect(draft).toMatchObject({ ok: false })
    if (!draft.ok) expect(draft.message.toLowerCase()).toContain('role')
  })

  test('refuses a birthday that is not a real date', () => {
    for (const birthday of ['14.07.2001', '2001-02-30', '2027-01-01']) {
      expect(
        draftProfile({ displayName: 'Julius', preferredRole: 'MID', birthday }, today),
      ).toMatchObject({ ok: false })
    }
  })

  test('a birthday is optional: leaving it empty is never an error', () => {
    expect(
      draftProfile({ displayName: 'Julius', preferredRole: 'SUP', birthday: '' }, today),
    ).toMatchObject({ ok: true })
  })
})

describe('draftAccount', () => {
  test('trims both halves and carries the chosen platform', () => {
    expect(draftAccount(' Hide on bush ', ' EUW ', 'eun1')).toEqual({
      ok: true,
      body: { gameName: 'Hide on bush', tagLine: 'EUW', platform: 'eun1' },
    })
  })

  test('the platform defaults to euw1, which is what most of this team plays', () => {
    expect(draftAccount('Hide on bush', 'EUW')).toEqual({
      ok: true,
      body: { gameName: 'Hide on bush', tagLine: 'EUW', platform: 'euw1' },
    })
  })

  test('a platform outside the Riot list is refused before a round trip', () => {
    expect(draftAccount('Hide on bush', 'EUW', 'europe')).toMatchObject({ ok: false })
  })

  test('a missing half is refused before a round trip', () => {
    expect(draftAccount('   ', 'EUW')).toMatchObject({ ok: false })
    expect(draftAccount('Hide on bush', '  ')).toMatchObject({ ok: false })
  })
})

describe('prefillProfile', () => {
  test('with no saved row, the Discord name is the display name and nothing else is filled', () => {
    expect(prefillProfile(null, 'Julius')).toEqual({
      displayName: 'Julius',
      preferredRole: null,
      birthday: '',
    })
  })

  test('a cached row missing a field cannot crash the form', () => {
    // the shape an older build may have left in the query cache after a hot reload
    const stale = { preferredRole: null, birthday: null } as unknown as Parameters<
      typeof prefillProfile
    >[0]

    expect(prefillProfile(stale, 'Julius')).toEqual({
      displayName: 'Julius',
      preferredRole: null,
      birthday: '',
    })
  })

  test('a non-string birthday or display name is decoded, not passed on to .trim()', () => {
    // exactly the two crashes seen in the browser: a cached row whose fields were not strings
    const stale = {
      displayName: 42,
      preferredRole: 'JUNGLE',
      birthday: new Date('2001-07-14T00:00:00.000Z'),
    } as unknown as Parameters<typeof prefillProfile>[0]

    expect(prefillProfile(stale, 'Julius')).toEqual({
      displayName: 'Julius',
      preferredRole: null,
      birthday: '',
    })
  })

  test('a role that is not ours becomes "no preference" rather than an invalid select value', () => {
    const stale = {
      displayName: 'Jules',
      preferredRole: 'JUNGLE',
      birthday: null,
    } as unknown as Parameters<typeof prefillProfile>[0]

    expect(prefillProfile(stale, 'Julius').preferredRole).toBeNull()
  })

  test('with a saved row, the row wins and a null birthday becomes an empty field', () => {
    expect(
      prefillProfile(
        { displayName: 'Jules', preferredRole: 'JGL', birthday: null, updatedAt: 0 },
        'Julius',
      ),
    ).toEqual({ displayName: 'Jules', preferredRole: 'JGL', birthday: '' })
  })
})

describe('todayIso', () => {
  test('is the YYYY-MM-DD the birthday rule compares against', () => {
    expect(todayIso(new Date('2026-02-01T23:59:00.000Z'))).toBe('2026-02-01')
  })
})

describe('profileChanged', () => {
  const body = { displayName: 'Jules', preferredRole: 'JGL' as const, birthday: null }

  test('nothing saved yet means the first draft is a change', () => {
    expect(profileChanged(null, body)).toBe(true)
  })

  test('the same values are not a change — opening the page must not save', () => {
    expect(profileChanged({ ...body, updatedAt: 0 }, body)).toBe(false)
  })

  test('a different name, role or birthday is a change', () => {
    expect(profileChanged({ ...body, displayName: 'X', updatedAt: 0 }, body)).toBe(true)
    expect(profileChanged({ ...body, preferredRole: 'MID', updatedAt: 0 }, body)).toBe(true)
    expect(profileChanged({ ...body, birthday: '2001-07-14', updatedAt: 0 }, body)).toBe(true)
  })

  test('clearing the birthday is a change, not "no value"', () => {
    expect(profileChanged({ ...body, birthday: '2001-07-14', updatedAt: 0 }, body)).toBe(true)
  })
})
