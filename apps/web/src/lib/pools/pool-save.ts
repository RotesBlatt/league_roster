import { ApiError, messageOf } from '../../api/result.ts'

/**
 * What to tell the user when an **autosaved** pool write is refused (champion-pools.md §5).
 *
 * Kept out of the component for the reason the whole feature exists: a failed write must never look
 * like a successful one. "Somebody changed this in another tab — showing the latest version" is a
 * different sentence from "saving failed", and it is the one that decides whether the draft is
 * dropped (reload) or kept so the user can retry by changing something.
 */

export type SaveFailure = {
  message: string
  color: 'yellow' | 'red'
  /** `true` when the stored pool won and the draft has to go, so the page drops it and refetches. */
  reload: boolean
}

/**
 * What to tell the user when `PUT /api/pools` refuses.
 *
 * - `409`: the version we read is gone. The server's content is newer, so the honest reaction is to
 *   discard the draft and show that version — retrying would overwrite somebody else's work.
 * - `422`: a rule the page should have caught. Show the server's message verbatim; it names the
 *   field, and inventing our own wording would drift from the rule.
 * - anything else: keep the draft, say what happened.
 */
export function saveFailure(error: unknown): SaveFailure {
  const status = error instanceof ApiError ? error.status : 0

  if (status === 409) {
    return {
      message: 'Somebody changed this pool in another tab — showing the latest version.',
      color: 'yellow',
      reload: true,
    }
  }

  const message = error instanceof ApiError ? error.message : messageOf(error)
  return {
    message: message.length > 0 ? message : 'The pool could not be saved.',
    color: 'red',
    reload: false,
  }
}
