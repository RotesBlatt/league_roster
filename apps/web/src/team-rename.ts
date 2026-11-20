import { SHORT_NAME_MAX, TEAM_NAME_MAX } from '@lol/shared'

/**
 * Everything the admin page's rename form decides, kept out of the component so it can be
 * tested without a DOM: what to send, whether the captain actually changed anything, and what
 * a refusal means to a human. The API stays authoritative — these checks only save a round trip
 * (team-rename.md §4).
 */

/** Always includes `shortName`, because `''` is how the API is told to clear the tag. */
export type RenameTeamBody = { name: string; shortName: string }

export type RenameTeamDraft =
  | { ok: true; body: RenameTeamBody; unchanged: boolean }
  | { ok: false; message: string }

export type RenameTeamInput = {
  /** the team as it is now, from `GET /api/teams` */
  currentName: string
  currentShortName: string | null
  name: string
  shortName: string
}

export function draftRename(input: RenameTeamInput): RenameTeamDraft {
  const name = input.name.trim()
  if (!name) return { ok: false, message: 'Give the team a name.' }
  if (name.length > TEAM_NAME_MAX) {
    return { ok: false, message: `The name must be at most ${TEAM_NAME_MAX} characters.` }
  }

  // an emptied field is sent as '' so the API clears the column; it stays a real change
  const shortName = input.shortName.trim()
  if (shortName.length > SHORT_NAME_MAX) {
    return { ok: false, message: `The short name must be at most ${SHORT_NAME_MAX} characters.` }
  }

  return {
    ok: true,
    body: { name, shortName },
    unchanged: name === input.currentName && shortName === (input.currentShortName ?? ''),
  }
}

/**
 * The API already says *why* it refused (a 422 carries the rule that broke, e.g. "reserved"):
 * that is the message to show. The rest need translating into what to do next — 404 is the
 * captain's membership disappearing under them, which only a reload fixes.
 */
export function renameMessage(status: number, message: string): string {
  if (status === 401) return 'Your session expired — sign in again.'
  if (status === 404) return 'This team is no longer available to you — reload the page.'
  if (status === 409) return 'That team name is taken. Try a slightly different name.'
  return message
}
