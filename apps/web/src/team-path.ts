/**
 * The team a URL names. The switcher made it tempting to read `me.teamSlug` instead — but
 * `/api/me` reports the *oldest* membership, so that is only a default landing team, never
 * "the team you are looking at" (multi-team.md §11.7: the URL is the source of truth).
 */
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
