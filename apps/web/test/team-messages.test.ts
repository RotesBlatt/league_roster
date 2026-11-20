import { describe, expect, test } from 'bun:test'
import { renameTeamMessage, teamWriteMessage } from '../src/team-messages.ts'

/**
 * One home for "why did the team write fail?" — moved here from `create-team.ts` and
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
