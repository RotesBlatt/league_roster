import { type Role, type TaggableKind, validateManualMatch } from '@lol/shared'

/**
 * The hand-entry form's state (match-history.md §5.8, §7, §9) — plain data, no React.
 *
 * Two things shape it, both from how a game actually looks:
 *
 * - **five people, five lanes.** The form opens with the roster already in place, one row per player,
 *   each bringing their roster role. The role stays changeable — a scrim is exactly where people swap
 *   — but nobody should have to type the obvious five times at 23:30.
 * - **the enemy sits beside the player** it faced. A bare list of opponents cannot say whose lane an
 *   entry belongs to, and the games list needs precisely that to fill the lane-opponent column.
 *
 * The client does **not** get its own rules: `toBody` produces exactly the JSON the route accepts and
 * `formErrors` runs the same `validateManualMatch` the server runs.
 */

export type ManualPlayerDraft = {
  /** Stable per row, so React keys survive a removal in the middle of the list. Never sent. */
  id: string
  userId: string
  championId: string
  /** Our `Role`; prefilled from the roster and changeable. `''` means "not set". */
  role: string
  kills: string
  deaths: string
  assists: string
  /** The champion this player was against, beside the player — `''` when unknown (§7). */
  opponentChampionId: string
}

export type ManualFormDraft = {
  /** `datetime-local` value: the reader's wall clock, converted to an instant in `toBody`. */
  playedAt: string
  kind: TaggableKind
  win: boolean
  players: ManualPlayerDraft[]
  note: string
}

/** What the form needs from a roster entry: who, and which lane. */
export type RosterPerson = { userId: string; role: Role | null }

/** A League team fields five. The form always shows five rows so a missing player is visible. */
export const MANUAL_PLAYERS = 5

const pad = (value: number) => String(value).padStart(2, '0')

/** `YYYY-MM-DDTHH:mm` in the browser's zone — the shape a `datetime-local` input wants. */
function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** A blank player row. The opponent lives on the same row, because it is the same lane. */
export function emptyPlayer(): ManualPlayerDraft {
  return {
    id: crypto.randomUUID(),
    userId: '',
    championId: '',
    role: '',
    kills: '',
    deaths: '',
    assists: '',
    opponentChampionId: '',
  }
}

/**
 * The role a member plays on this team, from the roster — `''` when the roster has none.
 *
 * Deliberately no fallback to a preference or an alphabetical guess: an empty select says "we do not
 * know", while a wrong prefilled role is a value somebody will accept without reading it.
 */
export function roleForMember(roster: readonly RosterPerson[], userId: string): string {
  return roster.find((person) => person.userId === userId)?.role ?? ''
}

/**
 * The five rows a form starts with: the roster in order, then empty rows up to five.
 *
 * A short roster leaves the remaining rows empty rather than duplicating somebody; a long one is cut
 * at five, because a sixth row could not be saved anyway.
 */
export function prefilledPlayers(roster: readonly RosterPerson[]): ManualPlayerDraft[] {
  return Array.from({ length: MANUAL_PLAYERS }, (_unused, index) => {
    const person = roster[index]
    if (!person) return emptyPlayer()
    return { ...emptyPlayer(), userId: person.userId, role: person.role ?? '' }
  })
}

/**
 * Fill the rows from a roster that arrived **after** the form opened.
 *
 * Returns the **same array** when there is nothing to do — when the roster is empty, or when
 * somebody has already typed into the form. That identity is not a micro-optimisation: the caller
 * runs this inside a `useEffect` + `setState`, and a fresh array on every render is exactly how the
 * page hit React's "Maximum update depth exceeded". An unchanged reference makes the `setState` a
 * no-op, so the loop cannot start even if the effect's dependencies churn.
 */
export function prefillPlayers(
  players: readonly ManualPlayerDraft[],
  roster: readonly RosterPerson[],
): ManualPlayerDraft[] {
  if (roster.length === 0) return players as ManualPlayerDraft[]

  const touched = players.some(
    (player) =>
      player.userId.trim() !== '' ||
      player.championId.trim() !== '' ||
      player.opponentChampionId.trim() !== '',
  )
  // a late response must never overwrite a lineup somebody typed
  return touched ? (players as ManualPlayerDraft[]) : prefilledPlayers(roster)
}

/**
 * A fresh form: **right now** as the date (a scrim is entered minutes after it ends), the roster in
 * the five rows, and `scrim` as the kind — the games Riot cannot see are almost always practice.
 *
 * A short roster leaves the remaining rows empty rather than duplicating somebody; a long one is cut
 * at five, because a sixth row could not be saved anyway.
 */
export function emptyDraft(
  now: Date = new Date(),
  roster: readonly RosterPerson[] = [],
): ManualFormDraft {
  const players = Array.from({ length: MANUAL_PLAYERS }, (_unused, index) => {
    const person = roster[index]
    if (!person) return emptyPlayer()

    return {
      ...emptyPlayer(),
      userId: person.userId,
      role: person.role ?? '',
    }
  })

  return {
    playedAt: toLocalInput(now),
    kind: 'scrim',
    win: true,
    players,
    note: '',
  }
}

/** `''`/blank → `undefined` (the key is dropped); a real integer → a number; anything else → as typed. */
function numberish(value: string): number | string | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) ? parsed : trimmed
}

/**
 * The request body. Blank optionals are **omitted**, not sent as `''` or `0`: an empty role is not a
 * role, an empty opponent is not an enemy, and a blank note is `null` — differences the API's
 * validation and the games list both depend on.
 *
 * `opponents` is always empty here: this form pairs every enemy with a player, and sending the same
 * champion twice (once paired, once loose) would create a second enemy row.
 */
export function toBody(draft: ManualFormDraft): Record<string, unknown> {
  // the form always draws five rows, but a scrim is not always five: a row nobody touched is not a
  // player. A row with *anything* in it is sent, so the validator can name what is missing.
  const filled = draft.players.filter(
    (player) => player.userId.trim() !== '' || player.championId.trim() !== '',
  )

  const players = filled.map((player) => {
    const row: Record<string, unknown> = {
      userId: player.userId.trim(),
      championId: numberish(player.championId),
    }
    if (player.role.trim() !== '') row.role = player.role

    const opponentChampionId = numberish(player.opponentChampionId)
    if (opponentChampionId !== undefined) row.opponentChampionId = opponentChampionId

    for (const field of ['kills', 'deaths', 'assists'] as const) {
      const value = numberish(player[field])
      if (value !== undefined) row[field] = value
    }
    return row
  })

  // an unparseable date is sent as-is so the shared validator can say "playedAt must be a date"
  const instant = draft.playedAt === '' ? '' : new Date(draft.playedAt)
  const playedAt =
    instant === '' ? '' : Number.isNaN(instant.getTime()) ? draft.playedAt : instant.toISOString()

  const note = draft.note.trim()

  return {
    playedAt,
    kind: draft.kind,
    win: draft.win,
    players,
    opponents: [],
    note: note === '' ? null : note,
  }
}

/**
 * Every reason the server would give, before the request is made — because the rules are the same
 * function. An empty array means the form may be submitted.
 */
export function formErrors(draft: ManualFormDraft, now: Date = new Date()): string[] {
  const validated = validateManualMatch(toBody(draft), { now })
  return validated.ok ? [] : validated.errors
}

export function isSubmittable(draft: ManualFormDraft, now: Date = new Date()): boolean {
  return formErrors(draft, now).length === 0
}
