import { type TaggableKind, validateManualMatch } from '@lol/shared'

/**
 * The hand-entry form's state (match-history.md §5.8, §9) — plain data, no React.
 *
 * The client does **not** get its own rules: `toBody` produces exactly the JSON the route accepts and
 * `formErrors` runs the same `validateManualMatch` the server runs. A form that accepts what the API
 * refuses is a form that throws away somebody's typing at the last step, at 23:30, after a scrim.
 *
 * Everything here is strings, because that is what inputs produce. `toBody` is the one place they
 * become numbers, dates and `null`s — and the one place a value that is *not* a number (a champion
 * typed as "Sion") is deliberately left as typed, so the error that comes back names the real problem
 * instead of blaming a `0` nobody wrote.
 */

export type ManualPlayerDraft = {
  /** Stable per row, so React keys survive a removal in the middle of the list. Never sent. */
  id: string
  userId: string
  championId: string
  role: string
  kills: string
  deaths: string
  assists: string
}

export type ManualOpponentDraft = {
  id: string
  /** Champions only: an enemy in a scrim has no account of ours, so no name is asked for. */
  championId: string
}

export type ManualFormDraft = {
  /** `datetime-local` value: the reader's wall clock, converted to an instant in `toBody`. */
  playedAt: string
  kind: TaggableKind
  win: boolean
  players: ManualPlayerDraft[]
  opponents: ManualOpponentDraft[]
  note: string
}

const pad = (value: number) => String(value).padStart(2, '0')

/** `YYYY-MM-DDTHH:mm` in the browser's zone — the shape a `datetime-local` input wants. */
function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** A blank player row. `role`, KDA and the opponents stay empty until somebody fills them. */
export function emptyPlayer(): ManualPlayerDraft {
  return {
    id: crypto.randomUUID(),
    userId: '',
    championId: '',
    role: '',
    kills: '',
    deaths: '',
    assists: '',
  }
}

/** An empty opponent row. The id is local to the form; the API only ever sees a champion id. */
export function emptyOpponent(): ManualOpponentDraft {
  return { id: crypto.randomUUID(), championId: '' }
}

/**
 * A fresh form: **right now** as the date (a scrim is entered minutes after it ends), one empty
 * player, and `scrim` as the kind — the common case by far, since these are the games Riot cannot see.
 */
export function emptyDraft(now: Date = new Date()): ManualFormDraft {
  return {
    playedAt: toLocalInput(now),
    kind: 'scrim',
    win: true,
    players: [emptyPlayer()],
    opponents: [],
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
 * role, an empty champion is not an opponent, and a blank note is `null` — the difference the API's
 * validation and the games list both depend on.
 */
export function toBody(draft: ManualFormDraft): Record<string, unknown> {
  const players = draft.players.map((player) => {
    const row: Record<string, unknown> = {
      userId: player.userId.trim(),
      championId: numberish(player.championId),
    }
    if (player.role.trim() !== '') row.role = player.role

    for (const field of ['kills', 'deaths', 'assists'] as const) {
      const value = numberish(player[field])
      if (value !== undefined) row[field] = value
    }
    return row
  })

  const opponents = draft.opponents
    .map((opponent) => numberish(opponent.championId))
    .filter((champion) => champion !== undefined)
    .map((champion) => ({ championId: champion }))

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
    opponents,
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
