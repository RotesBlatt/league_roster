import { describe, expect, test } from 'bun:test'
import {
  assignLanes,
  type LaneParticipant,
  laneKey,
  roleFromTeamPosition,
  teamPositionFromRole,
} from '../src/match-lanes.ts'
import { ROLES } from '../src/team.ts'

/**
 * The lane derivations (match-history.md §7) — inference, labelled as such.
 *
 * Nothing in Riot's payload says "this was your lane opponent". The sheet's `Partner`,
 * `Lane-Gegner` and `Gegner-Partner` columns exist because the bot lane needs three extra names,
 * not one, so the cases that matter are: a full SR game, the bot pair in both directions, a solo
 * laner (no partner), and every game where the answer is honestly unknown.
 */

/** A 5v5 Summoner's Rift game, blue on side 100 and red on side 200. */
function game(blue: Record<string, string>, red: Record<string, string>): LaneParticipant[] {
  const build = (side: number, lanes: Record<string, string>): LaneParticipant[] =>
    Object.entries(lanes).map(([teamPosition, puuid], index) => ({
      puuid,
      side,
      slot: side === 100 ? index + 1 : index + 6,
      teamPosition,
    }))
  return [...build(100, blue), ...build(200, red)]
}

const sr = () =>
  game(
    { TOP: 'b-top', JUNGLE: 'b-jgl', MIDDLE: 'b-mid', BOTTOM: 'b-adc', UTILITY: 'b-sup' },
    { TOP: 'r-top', JUNGLE: 'r-jgl', MIDDLE: 'r-mid', BOTTOM: 'r-adc', UTILITY: 'r-sup' },
  )

const lanes = (participants: LaneParticipant[]) => assignLanes(participants)

describe('roleFromTeamPosition', () => {
  test('Riot’s five SR positions map to our ROLES', () => {
    expect(roleFromTeamPosition('TOP')).toBe('TOP')
    expect(roleFromTeamPosition('JUNGLE')).toBe('JGL')
    expect(roleFromTeamPosition('MIDDLE')).toBe('MID')
    expect(roleFromTeamPosition('BOTTOM')).toBe('ADC')
    expect(roleFromTeamPosition('UTILITY')).toBe('SUP')
  })

  test('an empty or unknown position is "no role", never a guess', () => {
    // Riot sends "" for non-SR queues and for a player whose position it could not resolve
    expect(roleFromTeamPosition('')).toBeNull()
    expect(roleFromTeamPosition(null)).toBeNull()
    expect(roleFromTeamPosition(undefined)).toBeNull()
    expect(roleFromTeamPosition('FILL')).toBeNull()
  })
})

describe('a full Summoner’s Rift game', () => {
  test('every participant gets an entry, keyed by side and slot', () => {
    const result = lanes(sr())
    expect(result.size).toBe(10)
    expect(result.get(laneKey(100, 4))).toBeDefined()
  })

  test('the bot lane is a pair on each side, not "the enemy"', () => {
    const result = lanes(sr())
    expect(result.get(laneKey(100, 4))).toEqual({
      partner: laneKey(100, 5),
      laneOpponent: laneKey(200, 9),
      opponentPartner: laneKey(200, 10),
    })
    // and the support reads the same triangle from the other end (red: BOTTOM=9, UTILITY=10)
    expect(result.get(laneKey(200, 10))).toEqual({
      partner: laneKey(200, 9),
      laneOpponent: laneKey(100, 5),
      opponentPartner: laneKey(100, 4),
    })
  })

  test('a solo laner has an opponent but no partner', () => {
    const result = lanes(sr())
    expect(result.get(laneKey(100, 1))).toEqual({
      partner: null,
      laneOpponent: laneKey(200, 6),
      opponentPartner: null,
    })
    expect(result.get(laneKey(100, 2))).toEqual({
      partner: null,
      laneOpponent: laneKey(200, 7),
      opponentPartner: null,
    })
    expect(result.get(laneKey(100, 3))?.laneOpponent).toBe(laneKey(200, 8))
  })
})

describe('games where the answer is unknown', () => {
  test('ARAM has no lanes at all — every field is empty, not "the other four"', () => {
    const aram = game({ '': 'b1' }, { '': 'r1' })
    expect(lanes(aram).get(laneKey(100, 1))).toEqual({
      partner: null,
      laneOpponent: null,
      opponentPartner: null,
    })
  })

  test('one empty position does not break the rest of the game', () => {
    const swapped = sr().map((participant) =>
      participant.puuid === 'b-mid' ? { ...participant, teamPosition: '' } : participant,
    )
    const result = lanes(swapped)
    expect(result.get(laneKey(100, 3))).toEqual({
      partner: null,
      laneOpponent: null,
      opponentPartner: null,
    })
    // its opponent loses the lane opponent too, because there is no lane to match
    expect(result.get(laneKey(200, 8))?.laneOpponent).toBeNull()
    expect(result.get(laneKey(100, 1))?.laneOpponent).toBe(laneKey(200, 6))
  })

  test('an unknown opponent (no puuid) is still a lane, just an unnamed one', () => {
    // a manual row has slots and champions; "who" may be exactly what nobody typed in
    const manual: LaneParticipant[] = [
      { puuid: 'b-adc', side: 100, slot: 1, teamPosition: 'BOTTOM' },
      { puuid: null, side: 100, slot: 2, teamPosition: 'UTILITY' },
      { puuid: null, side: 200, slot: 6, teamPosition: 'BOTTOM' },
      { puuid: null, side: 200, slot: 7, teamPosition: 'UTILITY' },
    ]
    const result = lanes(manual)
    // **the reason this is keyed by slot**: a hand-entered enemy has no puuid at all, and an
    // assignment that named people by puuid would answer `null` for every such lane
    expect(result.get(laneKey(100, 1))).toEqual({
      partner: laneKey(100, 2),
      laneOpponent: laneKey(200, 6),
      opponentPartner: laneKey(200, 7),
    })
    expect(result.size).toBe(4)
  })

  test('a missing support leaves the ADC without a partner, not with a wrong one', () => {
    const fourVfour = sr().filter(
      (participant) => participant.puuid !== 'b-sup' && participant.puuid !== 'r-sup',
    )
    const result = lanes(fourVfour)
    expect(result.get(laneKey(100, 4))).toEqual({
      partner: null,
      laneOpponent: laneKey(200, 9),
      opponentPartner: null,
    })
  })
})

describe('the pairing is deterministic', () => {
  test('two players reporting the same position do not swap answers between calls', () => {
    // autofill / role swap in Flex: both say MIDDLE. Lowest slot wins both times.
    const odd: LaneParticipant[] = [
      { puuid: 'a', side: 100, slot: 3, teamPosition: 'MIDDLE' },
      { puuid: 'b', side: 100, slot: 4, teamPosition: 'MIDDLE' },
      { puuid: 'c', side: 200, slot: 8, teamPosition: 'MIDDLE' },
    ]
    const first = lanes(odd)
    const second = lanes(odd)
    expect(first.get(laneKey(200, 8))?.laneOpponent).toBe(laneKey(100, 3))
    expect([...first.entries()]).toEqual([...second.entries()])
  })
})

/**
 * The other direction, needed the moment something *writes* a position: a hand-entered row has our
 * `Role` (what a person picked in a form) while `teamPosition` stores Riot's string, because that is
 * what `assignLanes` matches on and what a Riot row will contain. Two mappings in two files would be
 * the drift §5.4 forbids.
 */
describe('teamPositionFromRole', () => {
  test('our five roles map onto Riot’s five strings', () => {
    expect(teamPositionFromRole('TOP')).toBe('TOP')
    expect(teamPositionFromRole('JGL')).toBe('JUNGLE')
    expect(teamPositionFromRole('MID')).toBe('MIDDLE')
    expect(teamPositionFromRole('ADC')).toBe('BOTTOM')
    expect(teamPositionFromRole('SUP')).toBe('UTILITY')
  })

  test('the two directions agree for every role — one vocabulary, not two', () => {
    for (const role of ROLES) {
      expect(roleFromTeamPosition(teamPositionFromRole(role))).toBe(role)
    }
  })
})
