/** Team name limits. Shared so the create form and the API cannot disagree about them. */
export const TEAM_NAME_MAX = 80
/** A badge-sized tag next to the name, e.g. "DBW". Optional, so no minimum. */
export const SHORT_NAME_MAX = 8

export const ROLES = ['TOP', 'JGL', 'MID', 'ADC', 'SUP'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  TOP: 'Top',
  JGL: 'Jungle',
  MID: 'Mid',
  ADC: 'ADC',
  SUP: 'Support',
}

export const MEMBER_STATUSES = ['active', 'disabled'] as const
export type MemberStatus = (typeof MEMBER_STATUSES)[number]

export const USER_ROLES = ['captain', 'member'] as const
export type UserRole = (typeof USER_ROLES)[number]

export const QUEUES = ['RANKED_SOLO_5x5', 'RANKED_FLEX_SR'] as const
export type Queue = (typeof QUEUES)[number]

export const TIERS = [
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'EMERALD',
  'DIAMOND',
  'MASTER',
  'GRANDMASTER',
  'CHALLENGER',
] as const
export type Tier = (typeof TIERS)[number]

export const DIVISIONS = ['I', 'II', 'III', 'IV'] as const
export type Division = (typeof DIVISIONS)[number]

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

/** Small helper so the UI and API agree on what "this player can edit the roster" means. */
export function canManageTeam(user: { role: UserRole; status: MemberStatus } | null): boolean {
  return user?.status === 'active' && user.role === 'captain'
}
