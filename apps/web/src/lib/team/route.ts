import type { TeamSummary } from '@lol/api/schema-types'

/**
 * The team a URL names, and what that means for the page around it — read in one place.
 *
 * The three questions are the same question: `/t/<slug>` is the **source of truth** for which
 * tenant a request belongs to (multi-team.md §11.7). `GET /api/me` reports the *oldest*
 * membership, so it is only ever a default landing team — never "the team you are looking at".
 * Answering that wrongly is how the switcher and the admin page both hid themselves from a
 * captain whose oldest team was a different one, so the parsing, the menu's derived state and
 * the access decision live together rather than in three files that can drift apart.
 *
 * Plain module, no DOM: every case is testable without rendering a Menu or a route.
 */

/* ---------------------------------------------------------------- the path */

export function teamSlugFromPath(pathname: string): string | null {
  // slugs are [a-z0-9-] (see api slug.ts), so there is nothing to percent-decode
  const match = /^\/t\/([^/]+)/.exec(pathname)
  return match?.[1] ?? null
}

/** The page inside the team: '/admin', '/roster', or '' for a bare /t/<slug> or a non-team path. */
export function teamSection(pathname: string): string {
  const match = /^\/t\/[^/]+(\/.*)?$/.exec(pathname)
  return match?.[1] ?? ''
}

/**
 * The same page under another team's slug. Changing team is a change of *tenant*, not of page:
 * switching teams (and renaming one, which moves its slug) keeps you on the admin page you were
 * reading instead of dumping you on the roster. With no page to keep, the roster is the fallback.
 */
export function teamPathWithSlug(pathname: string, slug: string): string {
  return `/t/${slug}${teamSection(pathname) || '/roster'}`
}

/* ---------------------------------------------------------------- the menu */

/** The team the URL names, or null when it is not one of mine (stale link, disabled membership). */
export function currentTeam(teams: TeamSummary[], slug: string | null): TeamSummary | null {
  if (!slug) return null
  return teams.find((team) => team.slug === slug) ?? null
}

/** Everything the menu offers: the API's order, minus the team already open. */
export function otherTeams(teams: TeamSummary[], slug: string | null): TeamSummary[] {
  const current = currentTeam(teams, slug)
  return current ? teams.filter((team) => team.id !== current.id) : teams
}

/* ---------------------------------------------------------------- the guard */

/**
 * Who may open /t/:slug/admin. The URL names the team, so the answer comes from *that team's*
 * membership — `GET /api/teams` carries a `role` per team — never from `GET /api/me`.
 */
export type TeamRole = 'loading' | 'captain' | 'denied' | 'unavailable'

export function teamRole(teams: TeamSummary[] | undefined, teamSlug: string): TeamRole {
  // undecided, not denied: the first render happens before the list arrives, and answering
  // "denied" there would redirect a captain off their own page
  if (!teams) return 'loading'

  const team = teams.find((row) => row.slug === teamSlug)
  if (!team) {
    // **A row the list does not have is not a verdict.** A rename rewrites the slug, so between
    // the new row landing and the URL following it, the URL names a team that is no longer in
    // the list — and answering "denied" there redirected the captain to the roster of the slug
    // they had just renamed away from, which is how the shell ended up printing an identifier.
    // So we only act against a team we can see: absent means "ask", never "go away".
    return 'unavailable'
  }

  // a settled row that is not a captaincy is a real answer: a plain member, a disabled one
  return team.role === 'captain' ? 'captain' : 'denied'
}
