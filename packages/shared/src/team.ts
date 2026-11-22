/**
 * Roster vocabulary: what a team is called, what a position is called, and who may change it.
 *
 * Shared so the create form, the admin page and the API read the same list — a role added here is
 * usable everywhere, and a label can never disagree with its enum.
 */

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

/** Small helper so the UI and API agree on what "this player can edit the roster" means. */
export function canManageTeam(user: { role: UserRole; status: MemberStatus } | null): boolean {
  return user?.status === 'active' && user.role === 'captain'
}
