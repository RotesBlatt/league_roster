import { SHORT_NAME_MAX, TEAM_NAME_MAX } from '@lol/shared'

/**
 * What a team name form decides — creating a team or renaming one — and why the API said no.
 * One module because they are one form with two buttons: same two fields, same limits, same 401,
 * same "taken name" 409, and same blank-tag rule. Split across three files the two copies of the
 * failure messages had already started to differ by the time anyone noticed.
 *
 * The API stays authoritative throughout: these checks only save a round trip (team-rename.md §4).
 * Pure, so every case is testable without a DOM.
 */

/* ---------------------------------------------------------------- why it failed */

/**
 * Why a team write failed, in words a captain can act on.
 *
 * The API already says *why* it refused — a 422 carries the rule that broke ("That name is
 * reserved — pick another one") — so that is passed through untouched. Only the statuses whose
 * code is not an explanation get translated.
 */
export function teamWriteMessage(status: number, message: string): string {
  if (status === 401) return 'Your session expired — sign in again.'
  if (status === 409) return 'That team name is taken. Try a slightly different name.'
  return message
}

/** Renaming adds one case: a 404 on a team you are looking at means your membership went away. */
export function renameTeamMessage(status: number, message: string): string {
  if (status === 404) return 'This team is no longer available to you — reload the page.'
  return teamWriteMessage(status, message)
}

/* ---------------------------------------------------------------- creating */

/** What to send, and where to go afterwards. */
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

/* ---------------------------------------------------------------- renaming */

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

/** What to send, and whether the captain actually changed anything. */
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
