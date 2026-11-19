import type { TeamSummary } from '@lol/api/schema-types'

/**
 * What the team switcher derives from the list `GET /api/teams` returns. Pure, so the
 * interesting cases — a slug that is not in the list, a stale link, an account with one team —
 * are testable without rendering a Menu.
 */

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
