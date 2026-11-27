import { describe, expect, test } from 'bun:test'
import {
  emptyDraft,
  formErrors,
  isSubmittable,
  type ManualFormDraft,
  toBody,
} from '../../src/lib/matches/manual-form.ts'

/**
 * The hand-entry form's state (match-history.md §5.8, §9).
 *
 * The client does not get its own rules: `toBody` produces the exact JSON the API takes and
 * `formErrors` runs the **same** `validateManualMatch` the route runs. That is the point — a form
 * that accepts what the server refuses is a form that loses somebody's typing at the last step.
 */

const now = new Date('2026-11-25T12:00:00.000Z')

const complete: ManualFormDraft = {
  playedAt: '2026-11-20T21:30',
  kind: 'scrim',
  win: true,
  players: [
    {
      id: 'p1',
      userId: 'u1',
      championId: '103',
      role: 'MID',
      kills: '7',
      deaths: '2',
      assists: '9',
    },
  ],
  opponents: [
    { id: 'o1', championId: '24' },
    { id: 'o2', championId: '121' },
  ],
  note: '  good draft  ',
}

describe('emptyDraft', () => {
  test('opens with one empty player row and a sensible default', () => {
    const draft = emptyDraft(now)
    expect(draft.players).toHaveLength(1)
    expect(draft.players[0]).toMatchObject({ userId: '', championId: '' })
    // scrim is the common case: a hand-entered game is almost always practice
    expect(draft.kind).toBe('scrim')
    expect(draft.playedAt.length).toBeGreaterThan(0)
  })
})

describe('toBody', () => {
  test('sends numbers as numbers and the date as an instant', () => {
    const body = toBody(complete) as Record<string, unknown>
    expect(body.kind).toBe('scrim')
    expect(body.win).toBe(true)
    // compared as an instant, not as a string: `datetime-local` is the *reader's* clock, so the
    // UTC text differs by the machine's zone and an equality on the string would be a CI trap
    expect(new Date(String(body.playedAt)).getTime()).toBe(new Date('2026-11-20T21:30').getTime())
    expect(body.players).toEqual([
      { userId: 'u1', championId: 103, role: 'MID', kills: 7, deaths: 2, assists: 9 },
    ])
    expect(body.opponents).toEqual([{ championId: 24 }, { championId: 121 }])
    // trimmed here, so the server does not have to
    expect(body.note).toBe('good draft')
  })

  test('empty optional fields are left out instead of sent as blanks', () => {
    const draft: ManualFormDraft = {
      ...complete,
      players: [
        { id: 'p1', userId: 'u1', championId: '103', role: '', kills: '', deaths: '', assists: '' },
      ],
      opponents: [
        { id: 'o1', championId: '' },
        { id: 'o2', championId: '  ' },
      ],
      note: '   ',
    }
    const body = toBody(draft) as Record<string, unknown>
    // a blank role is not a role, a blank champion is not an opponent, a blank note is no note
    expect(body.players).toEqual([{ userId: 'u1', championId: 103 }])
    expect(body.opponents).toEqual([])
    expect(body.note).toBeNull()
  })

  test('a partly filled KDA keeps only what was typed', () => {
    const draft: ManualFormDraft = {
      ...complete,
      players: [
        {
          id: 'p1',
          userId: 'u1',
          championId: '103',
          role: 'MID',
          kills: '4',
          deaths: '',
          assists: '',
        },
      ],
    }
    const body = toBody(draft) as { players: Record<string, unknown>[] }
    expect(body.players[0]).toMatchObject({ kills: 4 })
    expect(body.players[0]?.deaths).toBeUndefined()
  })

  test('a champion that is not a number is sent as typed, so the error is the server’s to explain', () => {
    // converting to NaN here would turn "Sion" into a confusing "0" and lose what the user typed
    const draft: ManualFormDraft = {
      ...complete,
      players: [
        {
          id: 'p1',
          userId: 'u1',
          championId: 'Sion',
          role: '',
          kills: '',
          deaths: '',
          assists: '',
        },
      ],
    }
    const body = toBody(draft) as { players: { championId: unknown }[] }
    expect(body.players[0]?.championId).toBe('Sion')
  })
})

describe('formErrors runs the server’s own validation', () => {
  test('a complete draft has none', () => {
    expect(formErrors(complete, now)).toEqual([])
    expect(isSubmittable(complete, now)).toBe(true)
  })

  test('a missing player is reported before anything is sent', () => {
    const errors = formErrors(
      { ...complete, players: [{ ...complete.players[0]!, userId: '' }] },
      now,
    )
    expect(errors.join(' ')).toContain('userId')
  })

  test('a champion that is not a number is reported', () => {
    const errors = formErrors(
      { ...complete, players: [{ ...complete.players[0]!, championId: 'abc' }] },
      now,
    )
    expect(errors.length).toBeGreaterThan(0)
  })

  test('a date in the future is reported', () => {
    const errors = formErrors({ ...complete, playedAt: '2030-01-01T12:00' }, now)
    expect(errors.join(' ')).toContain('future')
  })

  test('more than five players is reported — the form cannot send a sixth', () => {
    const players = Array.from({ length: 6 }, (_unused, index) => ({
      ...complete.players[0]!,
      userId: `u${index + 1}`,
    }))
    expect(formErrors({ ...complete, players }, now).length).toBeGreaterThan(0)
  })

  test('the same person twice is reported', () => {
    const players = [complete.players[0]!, complete.players[0]!]
    const errors = formErrors({ ...complete, players }, now)
    expect(errors.join(' ')).toContain('twice')
  })

  test('every reason comes back at once, not one per submit', () => {
    const errors = formErrors(
      {
        ...complete,
        playedAt: '',
        players: [{ ...complete.players[0]!, userId: '', championId: '' }],
      },
      now,
    )
    expect(errors.length).toBeGreaterThanOrEqual(3)
  })
})
