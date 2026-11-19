import { describe, expect, test } from 'bun:test'
import { SHORT_NAME_MAX, TEAM_NAME_MAX } from '@lol/shared'
import { createTeamMessage, draftTeam, rosterPath } from '../src/create-team.ts'

/**
 * The create-team form's thinking, without a DOM: what to send, what a failure means,
 * and where to go afterwards.
 */
describe('draftTeam', () => {
  test('trims the name and leaves an empty short name out', () => {
    expect(draftTeam('  Die Besten ', '   ')).toEqual({
      ok: true,
      body: { name: 'Die Besten' },
    })
  })

  test('sends a trimmed short name when there is one', () => {
    expect(draftTeam('Die Besten', ' DBW ')).toEqual({
      ok: true,
      body: { name: 'Die Besten', shortName: 'DBW' },
    })
  })

  // a round trip to learn "you typed nothing" is a wasted round trip
  test('refuses a blank name without asking the API', () => {
    const draft = draftTeam('   ', '')
    expect(draft).toMatchObject({ ok: false })
    if (!draft.ok) expect(draft.message.toLowerCase()).toContain('name')
  })

  test('refuses a name the API would reject as too long', () => {
    expect(draftTeam('a'.repeat(TEAM_NAME_MAX + 1), '')).toMatchObject({ ok: false })
  })

  test('refuses a short name the API would reject as too long', () => {
    expect(draftTeam('Team', 'a'.repeat(SHORT_NAME_MAX + 1))).toMatchObject({ ok: false })
  })

  test('accepts exactly at the limits', () => {
    expect(draftTeam('a'.repeat(TEAM_NAME_MAX), 'a'.repeat(SHORT_NAME_MAX))).toMatchObject({
      ok: true,
    })
  })
})

describe('createTeamMessage', () => {
  // 409 means the name is fine but taken, so the message has to offer a way out
  test('turns a taken name into advice', () => {
    expect(createTeamMessage(409, 'That team name is already taken')).toContain('different name')
  })

  test('passes the API reason for a 422 straight through', () => {
    const reason = 'That name is reserved — pick another one'
    expect(createTeamMessage(422, reason)).toBe(reason)
  })

  test('an expired session says so instead of showing a raw 401', () => {
    expect(createTeamMessage(401, 'Not signed in')).toMatch(/sign in again/i)
  })

  test('anything else keeps the message it was given', () => {
    expect(createTeamMessage(500, 'Internal error')).toBe('Internal error')
  })
})

describe('rosterPath', () => {
  test('points at the new team’s roster', () => {
    expect(rosterPath('die-besten')).toBe('/t/die-besten/roster')
  })
})
