/**
 * What a player says about themselves, judged the same way by the setup checklist, the profile page
 * and the API.
 *
 * The rule reads counts and values, never rows, so "is my profile complete?" is answerable without
 * touching the database.
 */

import type { Role } from './team.ts'

/** Longest display name we accept. Same number the player's own profile and the roster use. */
export const DISPLAY_NAME_MAX = 40

/**
 * What a profile is judged by. The setup checklist and the "profile complete" rule read the same
 * list, so the two cannot disagree about what is still missing.
 *
 * A birthday is deliberately absent: it is personal data, so declining to share it must not keep
 * a profile incomplete. `isValidBirthday` still guards a value that *is* given.
 */
export type ProfileField = 'displayName' | 'preferredRole' | 'riotAccount'

/** A profile as far as the completeness rule is concerned — counts, not rows. */
export type ProfileState = {
  displayName: string | null
  preferredRole: Role | null
  /** Riot accounts belonging to the player. At least one is required, untested ones included. */
  accountCount: number
}

/**
 * Which fields still keep the profile from being complete, in display order. Computed, never
 * stored: a stored flag goes stale the moment an account is deleted.
 */
export function missingProfileFields(profile: ProfileState): ProfileField[] {
  const missing: ProfileField[] = []
  const name = profile.displayName?.trim() ?? ''

  if (name.length === 0 || name.length > DISPLAY_NAME_MAX) missing.push('displayName')
  if (!profile.preferredRole) missing.push('preferredRole')
  if (profile.accountCount < 1) missing.push('riotAccount')

  return missing
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * `YYYY-MM-DD` that actually exists on the calendar, is not in the future and is not an obvious
 * typo (`0001-01-01`). `today` is passed in as the same format so this stays timezone-free.
 */
export function isValidBirthday(value: string, today: string): boolean {
  const match = ISO_DATE.exec(value)
  if (!match) return false

  const [, y, m, d] = match
  const year = Number(y)
  const month = Number(m)
  const day = Number(d)

  if (year < 1900) return false
  if (value > today) return false

  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}
