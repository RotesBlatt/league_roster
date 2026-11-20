import { SHORT_NAME_MAX, TEAM_NAME_MAX } from '@lol/shared'

/**
 * What the create-team form decides, kept out of the component so it can be tested without a
 * DOM: what to send, and where to go afterwards. The API stays authoritative — these checks only
 * save a round trip. Failure messages live in `team-messages.ts`, shared with the rename flow.
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

/** Where the app goes once the team exists: its roster, addressed by slug. */
export function rosterPath(slug: string): string {
  return `/t/${slug}/roster`
}
