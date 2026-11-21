import type { ProfileDto } from '@lol/api/schema-types'
import { DISPLAY_NAME_MAX, isValidBirthday, type Role } from '@lol/shared'

/**
 * Everything the profile form decides, kept out of the component so it can be tested without a
 * DOM: what to send, and what the form starts with. Same shape as `create-team.ts` /
 * `team-rename.ts` — the API stays authoritative, these checks only save a round trip.
 */

/** The form's state. A date input gives `''`, never `null`, so that is what the draft holds. */
export type ProfileDraftState = {
  displayName: string
  preferredRole: Role | null
  birthday: string
}

/** `birthday: null` is explicit on purpose: a save is a full replace, so null means "cleared". */
export type ProfileBody = {
  displayName: string
  preferredRole: Role
  birthday: string | null
}

export type AccountBody = { gameName: string; tagLine: string }

export type Drafted<T> = { ok: true; body: T } | { ok: false; message: string }

export function draftProfile(draft: ProfileDraftState, today: string): Drafted<ProfileBody> {
  const displayName = draft.displayName.trim()
  if (!displayName) return { ok: false, message: 'Give the display name.' }
  if (displayName.length > DISPLAY_NAME_MAX) {
    return {
      ok: false,
      message: `The display name must be at most ${DISPLAY_NAME_MAX} characters.`,
    }
  }

  // the role is a preference, not optional: the roster and pools both read it
  if (!draft.preferredRole) return { ok: false, message: 'Pick your role.' }

  const birthday = draft.birthday.trim()
  if (birthday && !isValidBirthday(birthday, today)) {
    return { ok: false, message: 'That is not a valid birthday.' }
  }

  return {
    ok: true,
    body: {
      displayName,
      preferredRole: draft.preferredRole,
      birthday: birthday || null,
    },
  }
}

/**
 * A Riot ID, split in two. Length limits are deliberately **not** duplicated here: they live with
 * the API's rules (`RIOT_*_MAX` in lib/riot-accounts.ts), the inputs carry `maxLength`, and the
 * API answers 422. A second copy of a number is a second thing to keep in sync.
 */
export function draftAccount(gameName: string, tagLine: string): Drafted<AccountBody> {
  const trimmedGameName = gameName.trim()
  if (!trimmedGameName) return { ok: false, message: 'Give the game name.' }

  const trimmedTagLine = tagLine.trim()
  if (!trimmedTagLine) return { ok: false, message: 'Give the tag line.' }

  return { ok: true, body: { gameName: trimmedGameName, tagLine: trimmedTagLine } }
}

/**
 * What the form shows on open. With no saved row the Discord name is the sensible default
 * (player-profiles.md §1); an empty birthday arrives as `''`, not `null`, because that is the
 * input's own empty value.
 */
export function prefillProfile(profile: ProfileDto | null, discordName: string): ProfileDraftState {
  if (!profile) return { displayName: discordName, preferredRole: null, birthday: '' }

  return {
    displayName: profile.displayName,
    preferredRole: profile.preferredRole,
    birthday: profile.birthday ?? '',
  }
}

/** Today as `YYYY-MM-DD`, the format the birthday rule compares against. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}
