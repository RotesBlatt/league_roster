import { describe, expect, test } from 'bun:test'
import type { TeamSummary } from '@lol/api/schema-types'
import {
  currentTeam,
  otherTeams,
  teamPathWithSlug,
  teamRole,
  teamSection,
  teamSlugFromPath,
} from '../../../src/lib/team/route.ts'

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

const team = (slug: string, name: string, shortName: string | null = null): TeamSummary => ({
  id: `id-${slug}`,
  slug,
  name,
  shortName,
  role: 'member',
})

const teams = [team('alpha', 'Alpha', 'AL'), team('bravo', 'Bravo'), team('charlie', 'Charlie')]

/**
 * The switcher's derived state: which team the header names, and which ones the menu offers.
 * Kept apart from the Menu component, which is only rendering.
 */
describe('currentTeam', () => {
  test('finds the team the URL names', () => {
    expect(currentTeam(teams, 'bravo')?.name).toBe('Bravo')
  })

  test('is null when the slug is not one of mine', () => {
    // a stale link, or a membership that was disabled while the tab was open
    expect(currentTeam(teams, 'deleted-team')).toBeNull()
  })

  test('is null without a slug at all', () => {
    expect(currentTeam(teams, null)).toBeNull()
  })
})

describe('otherTeams', () => {
  test('leaves out the team I am looking at', () => {
    expect(otherTeams(teams, 'alpha').map((entry) => entry.slug)).toEqual(['bravo', 'charlie'])
  })

  test('keeps the API’s order', () => {
    expect(otherTeams(teams, 'charlie').map((entry) => entry.slug)).toEqual(['alpha', 'bravo'])
  })

  test('offers everything when the current team is unknown', () => {
    expect(otherTeams(teams, 'nope').map((entry) => entry.slug)).toEqual([
      'alpha',
      'bravo',
      'charlie',
    ])
  })
})

/**
 * Who may open /t/:slug/admin. Regression: the page used `GET /api/me`, which names the
 * *oldest* membership, so an account that is a plain member of an older team and captain of
 * the one in the URL was redirected off its own admin page.
 */

const member = (slug: string, role: TeamSummary['role']): TeamSummary => ({
  id: `id-${slug}`,
  slug,
  name: slug.toUpperCase(),
  shortName: null,
  role,
})

describe('teamRole', () => {
  // the bug: captain of this team, member of the older one /api/me names
  test('is captain of the team in the URL, not of the account’s oldest team', () => {
    const rows = [member('alpha', 'member'), member('bravo', 'captain')]

    expect(teamRole(rows, 'bravo')).toBe('captain')
    expect(teamRole(rows, 'alpha')).toBe('denied')
  })

  test('a captain of another team is denied here', () => {
    expect(teamRole([member('bravo', 'captain'), member('alpha', 'member')], 'alpha')).toBe(
      'denied',
    )
  })

  test('a plain member is denied', () => {
    expect(teamRole([member('alpha', 'member')], 'alpha')).toBe('denied')
  })

  // a stale link and a disabled membership both simply do not appear in the list
  test('a slug that is not in my teams is denied', () => {
    expect(teamRole([member('alpha', 'captain')], 'gone')).toBe('denied')
    expect(teamRole([], 'alpha')).toBe('denied')
  })

  // the list arrives after the first render: deciding "denied" now would redirect a captain
  test('an unanswered list is loading, never denied', () => {
    expect(teamRole(undefined, 'alpha')).toBe('loading')
  })
})
