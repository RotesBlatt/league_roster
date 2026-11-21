import { MEMBER_STATUSES, ROLES, SHORT_NAME_MAX, TEAM_NAME_MAX, USER_ROLES } from '@lol/shared'
import { t } from 'elysia'

/**
 * t.UnionEnum hardcodes `default: values[0]` ("needed for generating error messages"), which
 * makes Elysia inject that default into any object that omits the field — a PATCH of
 * `{ status: 'active' }` would silently write `role: 'captain'`. Overriding it with undefined
 * keeps omitted properties omitted.
 */
export const roleSchema = t.UnionEnum(ROLES, { default: undefined })
/**
 * A role that must be *present*. `roleSchema` above allows omission (so a PATCH keeps the old
 * value); a full replace needs the opposite, and `t.UnionEnum` would inject its own default.
 */
export const requiredRoleSchema = t.Union(ROLES.map((role) => t.Literal(role)))
export const memberStatusSchema = t.UnionEnum(MEMBER_STATUSES, { default: undefined })
export const userRoleSchema = t.UnionEnum(USER_ROLES, { default: undefined })

/**
 * Params for a team-scoped route that also names a row.
 * `slug` comes from the /teams/:slug prefix, `id` from the route — and Elysia validates
 * the whole params object, so a missing key is rejected as an additionalProperty (422).
 */
export const teamParams = t.Object({ slug: t.String(), id: t.String() })

/**
 * The body both team writes take — `POST /api/teams` and `PATCH /api/teams/:slug` read the same
 * two fields, and two copies of this object had already drifted in their comments.
 *
 * It only bounds the input. The real rules (slug derived from the name, reserved words, trimming,
 * a blank tag meaning NULL) live in `lib/teams.ts`, where the routes' behaviour is tested.
 */
export const teamBody = t.Object({
  name: t.String({ minLength: 1, maxLength: TEAM_NAME_MAX }),
  // optional badge tag ("DBW"); no minimum, because blank means "no tag"
  shortName: t.Optional(t.String({ maxLength: SHORT_NAME_MAX })),
})

/** Random url-safe invite code, ~8 chars. */
export function inviteCode(length = 8): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}
