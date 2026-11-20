import { describe, expect, test } from 'bun:test'
import { teamSlugFromPath } from '../src/team-path.ts'

/** The URL is the only authority on "which team am I looking at" — see AppLayout's regression. */
describe('teamSlugFromPath', () => {
  test('reads the slug of a team page', () => {
    expect(teamSlugFromPath('/t/bravo/roster')).toBe('bravo')
    expect(teamSlugFromPath('/t/bravo/admin')).toBe('bravo')
  })

  test('reads a team page with no trailing segment', () => {
    expect(teamSlugFromPath('/t/bravo')).toBe('bravo')
  })

  test('is null for paths outside /t/<slug>', () => {
    expect(teamSlugFromPath('/')).toBeNull()
    expect(teamSlugFromPath('/login')).toBeNull()
    expect(teamSlugFromPath('/new-team')).toBeNull()
    expect(teamSlugFromPath('/join/ab12cd34')).toBeNull()
    expect(teamSlugFromPath('/teams/bravo')).toBeNull()
  })

  test('is null when the slug segment is empty or missing', () => {
    expect(teamSlugFromPath('/t/')).toBeNull()
    expect(teamSlugFromPath('/t')).toBeNull()
    expect(teamSlugFromPath('/t//roster')).toBeNull()
  })
})
