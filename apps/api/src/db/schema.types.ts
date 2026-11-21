import type { MemberStatus, Role, UserRole } from '@lol/shared'

export type Me = {
  id: string
  name: string
  email: string
  image: string | null
  /** null until the account belongs to a team; role/status come from that membership. */
  teamId: string | null
  /** how the SPA addresses that team: /t/<teamSlug>/roster */
  teamSlug: string | null
  role: UserRole
  /** null: no membership at all. 'disabled': this team disabled the account. */
  status: MemberStatus | null
}

/** The player's own profile (`/api/me/profile`). Global: no team is involved. */
export type ProfileDto = {
  displayName: string
  /** Position preference, not the permission — that is `membership.role`. */
  preferredRole: Role
  /** `YYYY-MM-DD`, or null when the player declined to share it. */
  birthday: string | null
  updatedAt: number
}

/** One of the player's League accounts (`/api/me/riot-accounts`). */
export type RiotAccountDto = {
  id: string
  /** Together with `tagLine` this is the label the player recognises: `gameName#tagLine`. */
  gameName: string
  tagLine: string
  /** Platform code, e.g. `euw1`. Fixed to the default until Riot validation exists. */
  platform: string
  /** At most one per player, enforced by a partial unique index. */
  isMain: boolean
  /** null = typed in but never checked against Riot; shown as "unverified", not as an error. */
  verifiedAt: number | null
}

export type PlayerDto = {
  id: string
  displayName: string
  role: Role
  riotGameName: string | null
  riotTagLine: string | null
  teamId: string
  note: string | null
  isActive: boolean
  userId: string | null
}

export type InviteDto = {
  id: string
  code: string
  note: string | null
  maxUses: number
  uses: number
  expiresAt: number | null
  revokedAt: number | null
  createdAt: number
  createdByName: string | null
  /** ready-to-copy path, e.g. /join/ab12cd34 */
  path: string
}

/** A team's own editable identity: the answer to `PATCH /api/teams/:slug`. */
export type TeamDto = {
  id: string
  /** derived from `name`, so a rename usually returns a different one */
  slug: string
  name: string
  shortName: string | null
}

/** One row of the team switcher: `GET /api/teams` — the teams the caller may act as. */
export type TeamSummary = {
  id: string
  slug: string
  name: string
  shortName: string | null
  role: UserRole
}

export type MemberDto = {
  id: string
  name: string
  email: string
  image: string | null
  role: UserRole
  status: MemberStatus
  createdAt: number
  hasPlayer: boolean
  teamId: string | null
}

export type ApiError = { message: string }
