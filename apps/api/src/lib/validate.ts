import { MEMBER_STATUSES, ROLES, USER_ROLES } from '@lol/shared'
import { t } from 'elysia'

/**
 * t.UnionEnum hardcodes `default: values[0]` ("needed for generating error messages"), which
 * makes Elysia inject that default into any object that omits the field — a PATCH of
 * `{ status: 'active' }` would silently write `role: 'captain'`. Overriding it with undefined
 * keeps omitted properties omitted.
 */
export const roleSchema = t.UnionEnum(ROLES, { default: undefined })
export const memberStatusSchema = t.UnionEnum(MEMBER_STATUSES, { default: undefined })
export const userRoleSchema = t.UnionEnum(USER_ROLES, { default: undefined })

/**
 * Params for a team-scoped route that also names a row.
 * `slug` comes from the /teams/:slug prefix, `id` from the route — and Elysia validates
 * the whole params object, so a missing key is rejected as an additionalProperty (422).
 */
export const teamParams = t.Object({ slug: t.String(), id: t.String() })

/** Random url-safe invite code, ~8 chars. */
export function inviteCode(length = 8): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}
