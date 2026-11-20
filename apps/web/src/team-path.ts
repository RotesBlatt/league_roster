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
