import { describe, expect, test } from 'bun:test'
import { SHORT_NAME_MAX, TEAM_NAME_MAX } from '@lol/shared'
import {
  draftRename,
  draftTeam,
  renameTeamMessage,
  rosterPath,
  teamWriteMessage,
} from '../../../src/lib/team/writes.ts'

/**
 * One home for "why did the team write fail?" — merged here from `create-team.ts` and
 * `team-rename.ts`, whose copies had already started to diverge. Behaviour is unchanged: the
 * assertions below are the ones those two files carried.
 */
describe('teamWriteMessage', () => {
  // 409 means the name is fine but taken, so the message has to offer a way out
  test('turns a taken name into advice', () => {
    expect(teamWriteMessage(409, 'That team name is already taken')).toContain('different name')
  })

  test('passes the API reason for a 422 straight through', () => {
    const reason = 'That name is reserved — pick another one'
    expect(teamWriteMessage(422, reason)).toBe(reason)
  })

  test('an expired session says so instead of showing a raw 401', () => {
    expect(teamWriteMessage(401, 'Not signed in')).toMatch(/sign in again/i)
  })

  test('anything else keeps the message it was given', () => {
    expect(teamWriteMessage(500, 'Internal error')).toBe('Internal error')
  })
})

describe('renameTeamMessage', () => {
  test('keeps everything the create flow says', () => {
    expect(renameTeamMessage(409, 'That team name is already taken')).toContain('different name')
    expect(renameTeamMessage(401, 'Not signed in')).toMatch(/sign in again/i)
    const reason = 'That name is reserved — pick another one'
    expect(renameTeamMessage(422, reason)).toBe(reason)
    expect(renameTeamMessage(500, 'Internal error')).toBe('Internal error')
  })

  // 404 here means the membership is gone, so a reload is the only way forward
  test('a team no longer reachable says to reload', () => {
    expect(renameTeamMessage(404, 'Not found')).toMatch(/reload/i)
  })
})

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

describe('rosterPath', () => {
  test('points at the new team’s roster', () => {
    expect(rosterPath('die-besten')).toBe('/t/die-besten/roster')
  })
})

/**
 * The admin page's rename form, without a DOM: what to send, whether anything changed, and
 * what a refusal means to a human. The API stays authoritative — these checks only save a
 * round trip (team-rename.md §4).
 */
describe('draftRename', () => {
  const current = { currentName: 'Alte Garde', currentShortName: 'AG' }

  test('trims both fields', () => {
    expect(draftRename({ ...current, name: '  Neue Welle ', shortName: ' NW ' })).toEqual({
      ok: true,
      body: { name: 'Neue Welle', shortName: 'NW' },
      unchanged: false,
    })
  })

  // the API reads a blank short name as "clear it", which only works if '' is actually sent
  test('sends an emptied short name as an empty string instead of dropping it', () => {
    expect(draftRename({ ...current, name: 'Neue Welle', shortName: '  ' })).toEqual({
      ok: true,
      body: { name: 'Neue Welle', shortName: '' },
      unchanged: false,
    })
  })

  test('a save with nothing edited is still a valid draft, but flagged unchanged', () => {
    expect(draftRename({ ...current, name: ' Alte Garde ', shortName: 'AG' })).toMatchObject({
      ok: true,
      unchanged: true,
    })
  })

  // a team without a tag must reach "unchanged" from an empty field
  test('an untouched empty short name against no current one is unchanged', () => {
    expect(
      draftRename({
        currentName: 'Ohne Tag',
        currentShortName: null,
        name: 'Ohne Tag',
        shortName: '',
      }),
    ).toMatchObject({ ok: true, unchanged: true })
  })

  test('changing only the short name counts as a change', () => {
    expect(draftRename({ ...current, name: 'Alte Garde', shortName: 'NEU' })).toMatchObject({
      ok: true,
      unchanged: false,
    })
  })

  test('changing only the letter case of the name counts as a change', () => {
    expect(draftRename({ ...current, name: 'ALTE GARDE', shortName: 'AG' })).toMatchObject({
      ok: true,
      unchanged: false,
    })
  })

  test('clearing a tag that exists counts as a change', () => {
    expect(draftRename({ ...current, name: 'Alte Garde', shortName: '' })).toMatchObject({
      ok: true,
      unchanged: false,
    })
  })

  test('refuses a blank name without asking the API', () => {
    const draft = draftRename({ ...current, name: '   ', shortName: 'AG' })
    expect(draft).toMatchObject({ ok: false })
    if (!draft.ok) expect(draft.message.toLowerCase()).toContain('name')
  })

  test('refuses names the API would reject as too long', () => {
    expect(
      draftRename({ ...current, name: 'a'.repeat(TEAM_NAME_MAX + 1), shortName: 'AG' }),
    ).toMatchObject({ ok: false })
    expect(
      draftRename({ ...current, name: 'Alte Garde', shortName: 'a'.repeat(SHORT_NAME_MAX + 1) }),
    ).toMatchObject({ ok: false })
  })

  test('accepts exactly at the limits', () => {
    expect(
      draftRename({
        currentName: 'x',
        currentShortName: null,
        name: 'a'.repeat(TEAM_NAME_MAX),
        shortName: 'a'.repeat(SHORT_NAME_MAX),
      }),
    ).toMatchObject({ ok: true })
  })
})
