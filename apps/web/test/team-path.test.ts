import { describe, expect, test } from 'bun:test'
import { teamPathWithSlug, teamSection, teamSlugFromPath } from '../src/team-path.ts'

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

/**
 * "Changing team" means changing the tenant, not the page you are on: switching in the header or
 * renaming a team used to dump you on the roster, which is a demotion if you were in the admin page.
 */
describe('teamSection', () => {
  test('reads the page inside the team', () => {
    expect(teamSection('/t/alpha/admin')).toBe('/admin')
    expect(teamSection('/t/alpha/roster')).toBe('/roster')
  })

  test('is empty for a team path with no page, and outside /t/<slug>', () => {
    expect(teamSection('/t/alpha')).toBe('')
    expect(teamSection('/new-team')).toBe('')
    expect(teamSection('/')).toBe('')
  })
})

describe('teamPathWithSlug', () => {
  test('keeps the page when the team changes', () => {
    expect(teamPathWithSlug('/t/alpha/admin', 'bravo')).toBe('/t/bravo/admin')
    expect(teamPathWithSlug('/t/alpha/roster', 'bravo')).toBe('/t/bravo/roster')
  })

  // nothing to keep: a page outside a team (or a bare team path) falls back to the roster
  test('falls back to the roster when there is no team page to stay on', () => {
    expect(teamPathWithSlug('/new-team', 'bravo')).toBe('/t/bravo/roster')
    expect(teamPathWithSlug('/', 'bravo')).toBe('/t/bravo/roster')
    expect(teamPathWithSlug('/t/alpha', 'bravo')).toBe('/t/bravo/roster')
  })
})
