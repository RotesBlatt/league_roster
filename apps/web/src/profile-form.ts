import type { ProfileDto } from '@lol/api/schema-types'
import {
  DEFAULT_RIOT_PLATFORM,
  DISPLAY_NAME_MAX,
  isPlatform,
  isValidBirthday,
  type Platform,
  ROLES,
  type Role,
} from '@lol/shared'

/**
 * Everything the profile form decides, kept out of the component so it can be tested without a
 * DOM: what to send, and what the form starts with. Same shape as `lib/team/writes.ts` — the
 * API stays authoritative, these checks only save a round trip.
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

export type AccountBody = { gameName: string; tagLine: string; platform: Platform }

export type Drafted<T> = { ok: true; body: T } | { ok: false; message: string }

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

const isRole = (value: unknown): value is Role =>
  typeof value === 'string' && (ROLES as readonly string[]).includes(value)

/**
 * Decodes whatever the cache or the form holds into a **valid** draft state.
 *
 * The input is not typed data: it is a value from the React Query cache, which during development
 * can still hold whatever an earlier build wrote (HMR keeps the cache). Two crashes came from this
 * — `displayName` and then `birthday` being non-strings — so the shape is checked here, once,
 * rather than trusted in every consumer.
 */
/** Whatever a cache row currently looks like — hence `unknown`, checked field by field. */
type DraftSource = { displayName?: unknown; preferredRole?: unknown; birthday?: unknown }

function toDraftState(
  value: DraftSource | null | undefined,
  discordName: string,
): ProfileDraftState {
  const displayName = asString(value?.displayName)

  return {
    displayName: displayName.length > 0 ? displayName : discordName,
    preferredRole: isRole(value?.preferredRole) ? value.preferredRole : null,
    birthday: asString(value?.birthday),
  }
}

export function draftProfile(draft: ProfileDraftState, today: string): Drafted<ProfileBody> {
  // tolerant by construction: this runs in an effect over cache-derived state, and a non-string
  // must read as "empty", never as a TypeError that takes the whole page down
  const displayName = asString(draft.displayName).trim()
  if (!displayName) return { ok: false, message: 'Give the display name.' }
  if (displayName.length > DISPLAY_NAME_MAX) {
    return {
      ok: false,
      message: `The display name must be at most ${DISPLAY_NAME_MAX} characters.`,
    }
  }

  // the role is a preference, not optional: the roster and pools both read it
  if (!draft.preferredRole) return { ok: false, message: 'Pick your role.' }

  const birthday = asString(draft.birthday).trim()
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
 * A Riot ID, split in two, plus the platform it lives on — the region is what decides which host
 * answers, so it is part of the account, not a detail of the form (§2).
 *
 * Length limits are deliberately **not** duplicated here: they live with the API's rules
 * (`RIOT_*_MAX` in lib/riot-accounts.ts), the inputs carry `maxLength`, and the API answers 422.
 * A second copy of a number is a second thing to keep in sync.
 */
export function draftAccount(
  gameName: string,
  tagLine: string,
  platform: string = DEFAULT_RIOT_PLATFORM,
): Drafted<AccountBody> {
  const trimmedGameName = gameName.trim()
  if (!trimmedGameName) return { ok: false, message: 'Give the game name.' }

  const trimmedTagLine = tagLine.trim()
  if (!trimmedTagLine) return { ok: false, message: 'Give the tag line.' }

  // the platform comes from a select of ours, but a stale cache or a hand-crafted call is cheap
  // to refuse here instead of letting the API answer 422 for it
  if (!isPlatform(platform)) return { ok: false, message: 'Pick a platform.' }

  return { ok: true, body: { gameName: trimmedGameName, tagLine: trimmedTagLine, platform } }
}

/**
 * What the form shows on open. With no saved row the Discord name is the sensible default
 * (player-profiles.md §1); an empty birthday arrives as `''`, not `null`, because that is the
 * input's own empty value.
 */
export function prefillProfile(profile: ProfileDto | null, discordName: string): ProfileDraftState {
  // the row is decoded, not trusted — see `toDraftState`
  return toDraftState(profile, discordName)
}

/**
 * Whether a save would actually change anything. Autosave runs on every edit, so this is what keeps
 * opening the page, or typing and undoing, from writing to the database.
 */
export function profileChanged(saved: ProfileDto | null, body: ProfileBody): boolean {
  if (!saved) return true

  return (
    saved.displayName !== body.displayName ||
    saved.preferredRole !== body.preferredRole ||
    saved.birthday !== body.birthday
  )
}

/** Today as `YYYY-MM-DD`, the format the birthday rule compares against. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}
