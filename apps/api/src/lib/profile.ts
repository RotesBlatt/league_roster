import { DISPLAY_NAME_MAX, isValidBirthday, ROLES, type Role } from '@lol/shared'
import type { ProfileDto } from '../db/schema.types.ts'

/**
 * The player's own profile, as a plain module: no db, no clock, no HTTP. The route hands in the
 * body and today's date and gets back either usable values or field problems — so the rules that
 * matter are unit-tested here rather than inferred from a request (AGENTS: keep rules out of
 * handlers).
 */

export type ProfileInput = {
  displayName: string
  preferredRole: Role
  /** `YYYY-MM-DD`, or absent/blank when the player declined to share it. */
  birthday?: string | null
}

/** What actually goes into the row. */
export type ProfileValues = {
  displayName: string
  preferredRole: Role
  birthday: string | null
}

/** One field-level complaint. `field` is what the form should mark, `message` what it shows. */
export type ProfileProblem = {
  field: 'displayName' | 'birthday'
  message: string
}

export type NormalizedProfile = {
  /** Best effort: a bad field is normalised to a safe value even when it is reported. */
  values: ProfileValues
  problems: ProfileProblem[]
}

/**
 * Trims, applies the shared display-name limit, and validates an *optional* birthday.
 *
 * A missing birthday is never a problem — it is personal data, and the DB column is nullable for
 * that reason. A given one must be a real calendar date that is not in the future; `today` is a
 * parameter so this stays timezone-free and testable.
 */
export function normalizeProfileInput(input: ProfileInput, today: string): NormalizedProfile {
  const problems: ProfileProblem[] = []

  const displayName = input.displayName.trim()
  if (displayName.length === 0) {
    problems.push({ field: 'displayName', message: 'Display name is required' })
  } else if (displayName.length > DISPLAY_NAME_MAX) {
    problems.push({
      field: 'displayName',
      message: `Display name must be at most ${DISPLAY_NAME_MAX} characters`,
    })
  }

  // a form that submits an untouched (or cleared) date field sends '' — that means "no birthday"
  const birthday = (input.birthday ?? '').trim() || null
  if (birthday !== null && !isValidBirthday(birthday, today)) {
    problems.push({ field: 'birthday', message: 'Birthday is not a valid date' })
  }

  return {
    values: {
      displayName,
      preferredRole: input.preferredRole,
      // a rejected birthday is stored as null, never as the string that failed the check
      birthday: birthday !== null && isValidBirthday(birthday, today) ? birthday : null,
    },
    problems,
  }
}

/**
 * The role, or null when the string is not one of ours.
 *
 * Deliberately *not* a TypeBox union in the route: Eden infers such a union as `never`, and a
 * business rule expressed as a tested function is easier to trust than one expressed as schema
 * shape. The route stays a wiring step.
 */
export function parseRole(value: string): Role | null {
  return (ROLES as readonly string[]).includes(value) ? (value as Role) : null
}

/** Today as `YYYY-MM-DD`, which is the format the birthday rule compares against. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** Row → wire shape. Dates become epoch ms, like every other DTO in this app. */
export function toProfileDto(row: {
  displayName: string
  preferredRole: Role
  birthday: string | null
  updatedAt: Date
}): ProfileDto {
  return {
    displayName: row.displayName,
    preferredRole: row.preferredRole,
    birthday: row.birthday,
    updatedAt: row.updatedAt.getTime(),
  }
}
