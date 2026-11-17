import type { MemberStatus, Role, UserRole } from '@lol/shared'

export type Me = {
  id: string
  name: string
  email: string
  image: string | null
  role: UserRole
  status: MemberStatus
}

export type PlayerDto = {
  id: string
  displayName: string
  role: Role
  riotGameName: string | null
  riotTagLine: string | null
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

export type MemberDto = {
  id: string
  name: string
  email: string
  image: string | null
  role: UserRole
  status: MemberStatus
  createdAt: number
  hasPlayer: boolean
}

export type ApiError = { message: string }
