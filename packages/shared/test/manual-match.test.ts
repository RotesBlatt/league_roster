import { describe, expect, test } from 'bun:test'
import { validateManualMatch } from '../src/manual-match.ts'

/**
 * Hand-entered matches (match-history.md §5.8, §10.14).
 *
 * The rules exist to keep the form *fillable*: a scrim block ends at 23:30 and nobody types KDA into
 * six fields then. So the minimum is a date, one of ours and a champion, and everything else is
 * optional — while the things that would corrupt the stats table (a duplicate player, a champion id
 * that is not an id, a date in the future) are refused outright.
 *
 * Input is `unknown` on purpose: this is the boundary where a JSON body stops being a guess.
 */

const playedAt = '2026-11-20T21:30:00.000Z'
const now = new Date('2026-11-25T12:00:00.000Z')

const minimal = {
  playedAt,
  kind: 'scrim',
  win: true,
  players: [{ userId: 'u1', championId: 103 }],
}

describe('the minimum a hand-entered scrim needs', () => {
  test('a date, one of ours, a champion and a result is enough', () => {
    const result = validateManualMatch(minimal, { now })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.playedAt.toISOString()).toBe(playedAt)
      expect(result.value.kind).toBe('scrim')
      expect(result.value.win).toBe(true)
      expect(result.value.players).toHaveLength(1)
      expect(result.value.opponents).toEqual([])
      expect(result.value.note).toBeNull()
    }
  })

  test('five players are accepted, and the KDA stays optional', () => {
    const players = ['u1', 'u2', 'u3', 'u4', 'u5'].map((userId) => ({ userId, championId: 1 }))
    const result = validateManualMatch({ ...minimal, players }, { now })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.players.every((player) => player.kills === null)).toBe(true)
    }
  })

  test('a KDA that is given is kept', () => {
    const result = validateManualMatch(
      { ...minimal, players: [{ userId: 'u1', championId: 103, kills: 7, deaths: 2, assists: 9 }] },
      { now },
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.players[0]).toMatchObject({ kills: 7, deaths: 2, assists: 9 })
    }
  })

  test('a role is optional, and validated against our vocabulary when present', () => {
    const ok = validateManualMatch(
      { ...minimal, players: [{ userId: 'u1', championId: 103, role: 'MID' }] },
      { now },
    )
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.value.players[0]?.role).toBe('MID')

    const bad = validateManualMatch(
      { ...minimal, players: [{ userId: 'u1', championId: 103, role: 'MIDDLE' }] },
      { now },
    )
    expect(bad.ok).toBe(false)
  })
})

describe('what is refused', () => {
  test('no players at all', () => {
    const result = validateManualMatch({ ...minimal, players: [] }, { now })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toContain('player')
  })

  test('a sixth player — a League team has five', () => {
    const players = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'].map((userId) => ({
      userId,
      championId: 1,
    }))
    expect(validateManualMatch({ ...minimal, players }, { now }).ok).toBe(false)
  })

  test('the same person twice — that would double their champion stats', () => {
    const players = [
      { userId: 'u1', championId: 1 },
      { userId: 'u1', championId: 2 },
    ]
    const result = validateManualMatch({ ...minimal, players }, { now })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toContain('twice')
  })

  test('a champion that is not an id', () => {
    for (const championId of [0, -1, 1.5, 'Sion', null]) {
      const result = validateManualMatch(
        { ...minimal, players: [{ userId: 'u1', championId }] },
        { now },
      )
      expect(result.ok).toBe(false)
    }
  })

  test('a date in the future — a typo, not a scheduled game', () => {
    const result = validateManualMatch(
      { ...minimal, playedAt: '2026-12-01T20:00:00.000Z' },
      { now },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toContain('future')
  })

  test('an unparseable date', () => {
    expect(validateManualMatch({ ...minimal, playedAt: 'gestern' }, { now }).ok).toBe(false)
    expect(validateManualMatch({ ...minimal, playedAt: undefined }, { now }).ok).toBe(false)
  })

  test('a kind a human may not choose — solo/flex are Riot facts (§6)', () => {
    for (const kind of ['solo', 'flex', 'other', 'nonsense']) {
      expect(validateManualMatch({ ...minimal, kind }, { now }).ok).toBe(false)
    }
  })

  test('a result that is not a result', () => {
    expect(validateManualMatch({ ...minimal, win: 'maybe' }, { now }).ok).toBe(false)
    expect(validateManualMatch({ ...minimal, win: undefined }, { now }).ok).toBe(false)
  })

  test('a negative kill count', () => {
    const result = validateManualMatch(
      { ...minimal, players: [{ userId: 'u1', championId: 103, kills: -2 }] },
      { now },
    )
    expect(result.ok).toBe(false)
  })

  test('one row with two problems reports both of them', () => {
    // the promise is "every reason at once": a row with no player and no champion has two faults,
    // and a form that shows them one per submit is a form nobody finishes
    const result = validateManualMatch(
      { ...minimal, players: [{ userId: '', championId: '' }] },
      { now },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('userId')
      expect(result.errors.join(' ')).toContain('championId')
    }
  })

  test('everything wrong at once reports every reason, not just the first', () => {
    // a form that fixes one error per submit is a form nobody finishes at 23:30
    const result = validateManualMatch({ playedAt: 'gestern', kind: 'solo', players: [] }, { now })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(3)
  })
})

describe('the opponents are optional, because a scrim often has no names', () => {
  test('opponent champions may be given', () => {
    const result = validateManualMatch(
      { ...minimal, opponents: [{ championId: 24 }, { championId: 121 }] },
      { now },
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.opponents.map((o) => o.championId)).toEqual([24, 121])
  })

  test('an opponent row with no champion is refused — it would render as nothing', () => {
    expect(validateManualMatch({ ...minimal, opponents: [{}] }, { now }).ok).toBe(false)
  })

  test('more than five opponents is refused', () => {
    const opponents = Array.from({ length: 6 }, () => ({ championId: 1 }))
    expect(validateManualMatch({ ...minimal, opponents }, { now }).ok).toBe(false)
  })
})

describe('the note', () => {
  test('is trimmed, and an empty note is no note', () => {
    const trimmed = validateManualMatch({ ...minimal, note: '  good draft  ' }, { now })
    expect(trimmed.ok).toBe(true)
    if (trimmed.ok) expect(trimmed.value.note).toBe('good draft')

    const empty = validateManualMatch({ ...minimal, note: '   ' }, { now })
    expect(empty.ok).toBe(true)
    if (empty.ok) expect(empty.value.note).toBeNull()
  })

  test('a note longer than the limit is refused rather than truncated', () => {
    // truncating silently loses what somebody wrote; the form can say "too long" instead
    const result = validateManualMatch({ ...minimal, note: 'x'.repeat(501) }, { now })
    expect(result.ok).toBe(false)
  })
})

/**
 * A player's own lane opponent (match-history.md §7).
 *
 * The form shows our five in a row and the enemy champion **beside each one**, because that is the
 * only way a human can say "this is the champion I was against". A bare list of opponents could not
 * express it: `opponents[2]` means nothing without the row it belongs to.
 */
describe('an opponent can belong to one of our players', () => {
  test('a player may name the champion they were against', () => {
    const result = validateManualMatch(
      { ...minimal, players: [{ userId: 'u1', championId: 103, opponentChampionId: 24 }] },
      { now },
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.players[0]?.opponentChampionId).toBe(24)
  })

  test('no opponent is null, not zero', () => {
    const result = validateManualMatch(minimal, { now })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.players[0]?.opponentChampionId).toBeNull()
  })

  test('an opponent that is not a champion id is refused', () => {
    for (const opponentChampionId of [0, -3, 1.5, 'Vayne']) {
      const result = validateManualMatch(
        { ...minimal, players: [{ userId: 'u1', championId: 103, opponentChampionId }] },
        { now },
      )
      expect(result.ok).toBe(false)
    }
  })

  test('the two ways to name an enemy can be used together', () => {
    // per-player for the lanes we know, the plain list for a fifth enemy nobody paired
    const result = validateManualMatch(
      {
        ...minimal,
        players: [{ userId: 'u1', championId: 103, opponentChampionId: 24 }],
        opponents: [{ championId: 121 }],
      },
      { now },
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.players[0]?.opponentChampionId).toBe(24)
      expect(result.value.opponents[0]?.championId).toBe(121)
    }
  })
})
