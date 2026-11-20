/**
 * Why a team write failed, in words a captain can act on.
 *
 * The API already says *why* it refused — a 422 carries the rule that broke ("That name is
 * reserved — pick another one") — so that is passed through untouched. Only the statuses whose
 * code is not an explanation get translated. Shared by creating a team and renaming one: they have
 * the same 401 and the same "taken name" 409, and two copies of this drifted the moment they were
 * written.
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
