import { describe, expect, test } from 'bun:test'
import {
  emptyDraft,
  emptyPlayer,
  formErrors,
  isSubmittable,
  type ManualFormDraft,
  prefillPlayers,
  roleForMember,
  toBody,
} from '../../src/lib/matches/manual-form.ts'

/**
 * The hand-entry form's state (match-history.md §5.8, §7, §9).
 *
 * Two things shape it: a game is played by **five people in five lanes**, so the form opens with the
 * roster already in place and a role per row (still changeable, because a scrim is where people
 * swap), and the enemy champion sits **beside the player** it faced — a bare list of opponents could
 * not say whose lane it was.
 *
 * The client still does not own the rules: `toBody` produces the exact JSON the route takes and
 * `formErrors` runs the **same** `validateManualMatch` the route runs.
 */

const now = new Date('2026-11-25T12:00:00.000Z')

const roster = [
  { userId: 'u1', role: 'TOP' as const },
  { userId: 'u2', role: 'JGL' as const },
  { userId: 'u3', role: null },
]

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
      opponentChampionId: '24',
    },
  ],
  note: '  good draft  ',
}

describe('emptyDraft', () => {
  test('opens with one row per roster spot, always five', () => {
    const draft = emptyDraft(now, roster)
    expect(draft.players).toHaveLength(5)
  })

  test('the roster is filled in, in the order it was given', () => {
    const draft = emptyDraft(now, roster)
    expect(draft.players[0]?.userId).toBe('u1')
    expect(draft.players[1]?.userId).toBe('u2')
    expect(draft.players[2]?.userId).toBe('u3')
  })

  test('each prefilled player brings their role, so nobody types the obvious five times', () => {
    const draft = emptyDraft(now, roster)
    expect(draft.players[0]?.role).toBe('TOP')
    expect(draft.players[1]?.role).toBe('JGL')
    // no role on the roster entry is an empty select, not a guessed MIDDLE
    expect(draft.players[2]?.role).toBe('')
  })

  test('a short roster leaves the rest empty instead of inventing players', () => {
    const draft = emptyDraft(now, roster.slice(0, 2))
    expect(draft.players).toHaveLength(5)
    expect(draft.players[2]).toMatchObject({ userId: '', championId: '' })
  })

  test('a full roster does not become a sixth row', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((userId) => ({ userId, role: null }))
    expect(emptyDraft(now, [...five, { userId: 'f', role: null }]).players).toHaveLength(5)
  })

  test('scrim is the default kind and the date is now', () => {
    const draft = emptyDraft(now, roster)
    expect(draft.kind).toBe('scrim')
    expect(draft.playedAt.length).toBeGreaterThan(0)
  })
})

/**
 * The prefill the form runs when the roster arrives late.
 *
 * **Regression test.** It used to be an effect calling `setDraft` with a freshly mapped roster array
 * in its dependency list: every render produced a new array, so the effect re-ran, set state, and React
 * stopped the page with "Maximum update depth exceeded". The fix is that this function is
 * **idempotent and reference-preserving**: once the rows are filled it returns the *same* array, so a
 * `setState` with the result is a no-op and the loop cannot start — even if the dependencies churn.
 */
describe('prefillPlayers', () => {
  test('fills untouched rows from the roster', () => {
    const filled = prefillPlayers(emptyDraft(now).players, roster)
    expect(filled.map((player) => player.userId)).toEqual(['u1', 'u2', 'u3', '', ''])
  })

  test('is idempotent: prefilling twice returns the same array, so setState cannot loop', () => {
    const once = prefillPlayers(emptyDraft(now).players, roster)
    const twice = prefillPlayers(once, roster)
    // reference equality is the whole point: React bails out when the state value is unchanged
    expect(twice).toBe(once)
  })

  test('never overwrites a lineup somebody has started to type', () => {
    const touched = [{ ...emptyPlayer(), userId: 'u1', championId: '103' }]
    expect(prefillPlayers(touched, roster)).toBe(touched)
  })

  test('an empty roster changes nothing, and also returns the same array', () => {
    const players = emptyDraft(now).players
    expect(prefillPlayers(players, [])).toBe(players)
  })
})

describe('roleForMember', () => {
  test('picking a teammate brings their roster role with them', () => {
    expect(roleForMember(roster, 'u2')).toBe('JGL')
  })

  test('somebody without a roster role, or not on the roster, brings nothing', () => {
    expect(roleForMember(roster, 'u3')).toBe('')
    expect(roleForMember(roster, 'stranger')).toBe('')
  })
})

describe('toBody', () => {
  test('sends our players with their lane opponent, and the date as an instant', () => {
    const body = toBody(complete) as Record<string, unknown>
    expect(body.kind).toBe('scrim')
    expect(body.win).toBe(true)
    expect(new Date(String(body.playedAt)).getTime()).toBe(new Date('2026-11-20T21:30').getTime())
    expect(body.players).toEqual([
      {
        userId: 'u1',
        championId: 103,
        role: 'MID',
        kills: 7,
        deaths: 2,
        assists: 9,
        opponentChampionId: 24,
      },
    ])
    // the paired enemy travels on the player; the loose list is not used by this form
    expect(body.opponents).toEqual([])
    expect(body.note).toBe('good draft')
  })

  test('empty optional fields are left out instead of sent as blanks', () => {
    const body = toBody({
      ...complete,
      players: [
        {
          id: 'p1',
          userId: 'u1',
          championId: '103',
          role: '',
          kills: '',
          deaths: '',
          assists: '',
          opponentChampionId: '',
        },
      ],
      note: '   ',
    }) as { players: Record<string, unknown>[]; note: unknown }
    // a blank role is not a role, a blank opponent is not an opponent, a blank note is no note
    expect(body.players[0]).toEqual({ userId: 'u1', championId: 103 })
    expect(body.note).toBeNull()
  })

  test('a partly filled KDA keeps only what was typed', () => {
    const body = toBody({
      ...complete,
      players: [{ ...complete.players[0]!, kills: '4', deaths: '', assists: '' }],
    }) as { players: Record<string, unknown>[] }
    expect(body.players[0]).toMatchObject({ kills: 4 })
    expect(body.players[0]?.deaths).toBeUndefined()
  })

  test('an untouched row is not sent — the form always shows five, but four players is a real game', () => {
    // without this, a scrim played 4v5 could never be saved: the fifth row would fail validation
    const body = toBody({ ...complete, players: [...complete.players, emptyPlayer()] }) as {
      players: unknown[]
    }
    expect(body.players).toHaveLength(1)
  })

  test('a row with something in it is still sent, even if it is wrong', () => {
    // a champion without a player is an error the validator should name, not silently drop
    const half = { ...emptyPlayer(), championId: '103' }
    const body = toBody({ ...complete, players: [half] }) as { players: unknown[] }
    expect(body.players).toHaveLength(1)
  })

  test('a champion that is not a number is sent as typed, so the error is the server’s to explain', () => {
    const body = toBody({
      ...complete,
      players: [{ ...complete.players[0]!, championId: 'Sion' }],
    }) as { players: { championId: unknown }[] }
    expect(body.players[0]?.championId).toBe('Sion')
  })
})

describe('formErrors runs the server’s own validation', () => {
  test('a complete draft has none', () => {
    expect(formErrors(complete, now)).toEqual([])
    expect(isSubmittable(complete, now)).toBe(true)
  })

  test('a row with no player is reported before anything is sent', () => {
    const errors = formErrors(
      { ...complete, players: [{ ...complete.players[0]!, userId: '' }] },
      now,
    )
    expect(errors.join(' ')).toContain('userId')
  })

  test('a date in the future is reported', () => {
    expect(formErrors({ ...complete, playedAt: '2030-01-01T12:00' }, now).join(' ')).toContain(
      'future',
    )
  })

  test('the same person twice is reported', () => {
    const errors = formErrors(
      { ...complete, players: [complete.players[0]!, complete.players[0]!] },
      now,
    )
    expect(errors.join(' ')).toContain('twice')
  })

  test('every reason comes back at once, not one per submit', () => {
    const errors = formErrors(
      // a row with *something* in it, so it is not dropped as untouched: no player, a bad champion,
      // and no date — three separate reasons in one submit
      { ...complete, playedAt: '', players: [{ ...emptyPlayer(), championId: 'Sion' }] },
      now,
    )
    expect(errors.length).toBeGreaterThanOrEqual(3)
  })
})
