import { SHORT_NAME_MAX, TEAM_NAME_MAX } from '@lol/shared'

/**
 * Everything the create-team form decides, kept out of the component so it can be tested
 * without a DOM: what to send (if anything), what a failure means to a human, and where to
 * go afterwards. the API stays authoritative — these checks only save a round trip.
 */

export type CreateTeamBody = { name: string; shortName?: string }
export type CreateTeamDraft = { ok: true; body: CreateTeamBody } | { ok: false; message: string }

export function draftTeam(name: string, shortName: string): CreateTeamDraft {
  const trimmedName = name.trim()
  if (!trimmedName) return { ok: false, message: 'Give the team a name.' }
  if (trimmedName.length > TEAM_NAME_MAX) {
    return { ok: false, message: `The name must be at most ${TEAM_NAME_MAX} characters.` }
  }

  // blank means "no tag": send nothing, so the column stays NULL instead of ''
  const trimmedShortName = shortName.trim()
  if (trimmedShortName.length > SHORT_NAME_MAX) {
    return { ok: false, message: `The short name must be at most ${SHORT_NAME_MAX} characters.` }
  }

  return {
    ok: true,
    body: trimmedShortName
      ? { name: trimmedName, shortName: trimmedShortName }
      : { name: trimmedName },
  }
}

/**
 * The API already says *why* it refused (422 carries the rule that broke, e.g. "reserved"):
 * that is the message to show. Only two statuses need translating — an expired session, and
 * a taken name, where the useful thing to say is what to do next.
 */
export function createTeamMessage(status: number, message: string): string {
  if (status === 401) return 'Your session expired — sign in again.'
  if (status === 409) return 'That team name is taken. Try a slightly different name.'
  return message
}

/** Where the app goes once the team exists: its roster, addressed by slug. */
export function rosterPath(slug: string): string {
  return `/t/${slug}/roster`
}
