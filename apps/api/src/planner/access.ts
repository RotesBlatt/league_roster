/**
 * The one permission rule the planner adds to "you are a member here": availability is personal.
 *
 * Extracted like `claimInvite`, so it is a tested function instead of an `if` buried in a handler —
 * and so the answer to "can a captain rewrite Anna's Tuesday?" lives in one reviewable place: no.
 * A typo in someone's week is fixed by that person, not by an edit that quietly makes the summary
 * someone else's version of the truth (availability-planner.md §8).
 */
export function canEditAvailability(me: { id: string } | null, targetUserId: string): boolean {
  return me !== null && me.id === targetUserId
}
