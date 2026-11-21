import { describe, expect, test } from 'bun:test'
import { DISPLAY_NAME_MAX } from '@lol/shared'
import { draftAccount, draftProfile, prefillProfile, todayIso } from '../src/profile-form.ts'

/**
 * The profile form's thinking, without a DOM: what to send, and what the form starts with.
 * The API stays authoritative — these checks only save a round trip, exactly like
 * `create-team.ts` and `team-rename.ts`.
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
  test('trims both halves of the Riot ID', () => {
    expect(draftAccount(' Hide on bush ', ' EUW ')).toEqual({
      ok: true,
      body: { gameName: 'Hide on bush', tagLine: 'EUW' },
    })
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
