import { describe, expect, test } from 'bun:test'
import type { TeamSummary } from '@lol/api/schema-types'
import { teamRole } from '../src/team-role.ts'

/**
 * Who may open /t/:slug/admin. Regression: the page used `GET /api/me`, which names the
 * *oldest* membership, so an account that is a plain member of an older team and captain of
 * the one in the URL was redirected off its own admin page.
 */

const team = (slug: string, role: TeamSummary['role']): TeamSummary => ({
  id: `id-${slug}`,
  slug,
  name: slug.toUpperCase(),
  shortName: null,
  role,
})

describe('teamRole', () => {
  // the bug: captain of this team, member of the older one /api/me names
  test('is captain of the team in the URL, not of the account’s oldest team', () => {
    const teams = [team('alpha', 'member'), team('bravo', 'captain')]

    expect(teamRole(teams, 'bravo')).toBe('captain')
    expect(teamRole(teams, 'alpha')).toBe('denied')
  })

  test('a captain of another team is denied here', () => {
    expect(teamRole([team('bravo', 'captain'), team('alpha', 'member')], 'alpha')).toBe('denied')
  })

  test('a plain member is denied', () => {
    expect(teamRole([team('alpha', 'member')], 'alpha')).toBe('denied')
  })

  // a stale link and a disabled membership both simply do not appear in the list
  test('a slug that is not in my teams is denied', () => {
    expect(teamRole([team('alpha', 'captain')], 'gone')).toBe('denied')
    expect(teamRole([], 'alpha')).toBe('denied')
  })

  // the list arrives after the first render: deciding "denied" now would redirect a captain
  test('an unanswered list is loading, never denied', () => {
    expect(teamRole(undefined, 'alpha')).toBe('loading')
  })
})
