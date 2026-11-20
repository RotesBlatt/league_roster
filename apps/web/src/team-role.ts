import type { TeamSummary } from '@lol/api/schema-types'

/**
 * Who may open /t/:slug/admin. The URL names the team, so the answer comes from *that team's*
 * membership — `GET /api/teams` carries a `role` per team — never from `GET /api/me`, which
 * `lib/access.ts` documents as the **oldest** membership. Reading `me.role` here hid the page
 * from a captain whose oldest team was a different one.
 *
 * Plain module so the three outcomes are testable without rendering the page.
 */
export type TeamRole = 'loading' | 'captain' | 'denied'

export function teamRole(teams: TeamSummary[] | undefined, teamSlug: string): TeamRole {
  // undecided, not denied: the first render happens before the list arrives, and answering
  // "denied" there would redirect a captain off their own page
  if (!teams) return 'loading'

  const team = teams.find((row) => row.slug === teamSlug)
  // a stale link and a disabled membership are both simply absent from the list
  return team?.role === 'captain' ? 'captain' : 'denied'
}
