import { MEMBER_STATUSES, ROLES, USER_ROLES } from '@lol/shared'
import { t } from 'elysia'

export const roleSchema = t.UnionEnum(ROLES)
export const memberStatusSchema = t.UnionEnum(MEMBER_STATUSES)
export const userRoleSchema = t.UnionEnum(USER_ROLES)

/** Random url-safe invite code, ~8 chars. */
export function inviteCode(length = 8): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}
// schemas shared by the API routes
