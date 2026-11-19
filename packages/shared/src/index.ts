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

/** Small helper so the UI and API agree on what "this player can edit the roster" means. */
export function canManageTeam(user: { role: UserRole; status: MemberStatus } | null): boolean {
  return user?.status === 'active' && user.role === 'captain'
}
