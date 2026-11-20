import { SHORT_NAME_MAX, TEAM_NAME_MAX } from '@lol/shared'

/**
 * Everything the admin page's rename form decides, kept out of the component so it can be
 * tested without a DOM: what to send and whether the captain actually changed anything. The API
 * stays authoritative — these checks only save a round trip (team-rename.md §4). Failure messages
 * live in `team-messages.ts`, shared with the create flow.
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
