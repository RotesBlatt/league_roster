import { TAGGABLE_KINDS, type TaggableKind } from './match.ts'
import { ROLES, type Role } from './team.ts'

/**
 * What a hand-entered match has to be (match-history.md §5.8, §10.14).
 *
 * The rules are shaped by *when* this form is used: a scrim block ends at 23:30 and nobody types a
 * KDA into six fields then. So the minimum is a date, a result, and one of ours with a champion —
 * everything else is optional — while the things that would silently corrupt the champion table (a
 * duplicate player, a champion id that is not an id, a date in the future) are refused.
 *
 * `input` is `unknown` because this is the boundary where a JSON body stops being a guess, and the
 * function returns **every** reason at once: a form that surfaces one error per submit is a form
 * nobody finishes.
 */

export const MANUAL_NOTE_MAX = 500
export const MANUAL_PLAYERS_MAX = 5
export const MANUAL_OPPONENTS_MAX = 5

/** A clock a few minutes ahead is a browser, not a foretelling — refuse only the clear typo. */
const FUTURE_SKEW_MS = 5 * 60_000

export type ManualMatchPlayer = {
  userId: string
  championId: number
  /** Our role vocabulary, or `null` when nobody said — a scrim often has no assigned roles. */
  role: Role | null
  kills: number | null
  deaths: number | null
  assists: number | null
}

/** What we know about an enemy in a hand-entered game: their champion, and nothing else. */
export type ManualMatchOpponent = { championId: number }

export type ManualMatch = {
  playedAt: Date
  /** A human label, because a manual row has no `queueId` to classify (§5.8). */
  kind: TaggableKind
  /** Our side's result — a scrim is not a game where two of ours lost and three won. */
  win: boolean
  players: ManualMatchPlayer[]
  opponents: ManualMatchOpponent[]
  note: string | null
}

export type ManualMatchResult = { ok: true; value: ManualMatch } | { ok: false; errors: string[] }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** An optional non-negative whole number: absent is `null`, `0` is a real zero. */
function optionalCount(value: unknown, label: string, errors: string[]): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    errors.push(`${label} must be a whole number of 0 or more`)
    return null
  }
  return value
}

function championId(value: unknown, label: string, errors: string[]): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    errors.push(`${label} must be a positive champion id`)
    return null
  }
  return value
}

export function validateManualMatch(
  input: unknown,
  options: { now?: Date } = {},
): ManualMatchResult {
  const errors: string[] = []
  if (!isRecord(input)) return { ok: false, errors: ['a match body is required'] }

  const now = options.now ?? new Date()

  // --- when -------------------------------------------------------------------------------------
  const rawPlayedAt = input.playedAt
  const playedAt = typeof rawPlayedAt === 'string' ? new Date(rawPlayedAt) : new Date(Number.NaN)
  if (Number.isNaN(playedAt.getTime())) {
    errors.push('playedAt must be a date')
  } else if (playedAt.getTime() > now.getTime() + FUTURE_SKEW_MS) {
    errors.push('playedAt cannot be in the future')
  }

  // --- what kind of game ------------------------------------------------------------------------
  const kind = input.kind
  if (typeof kind !== 'string' || !TAGGABLE_KINDS.includes(kind as TaggableKind)) {
    // solo/flex are Riot facts (§6): a human may not claim a game was ranked SoloQ
    errors.push(`kind must be one of ${TAGGABLE_KINDS.join(', ')}`)
  }

  // --- the result --------------------------------------------------------------------------------
  const win = input.win
  if (typeof win !== 'boolean') errors.push('win must be true or false')

  // --- our side ----------------------------------------------------------------------------------
  const rawPlayers = input.players
  const players: ManualMatchPlayer[] = []
  if (!Array.isArray(rawPlayers) || rawPlayers.length === 0) {
    errors.push('at least one player is required')
  } else if (rawPlayers.length > MANUAL_PLAYERS_MAX) {
    errors.push(`no more than ${MANUAL_PLAYERS_MAX} players`)
  } else {
    const seen = new Set<string>()
    for (const [index, raw] of rawPlayers.entries()) {
      if (!isRecord(raw)) {
        errors.push(`player ${index + 1} is not an object`)
        continue
      }
      const userId = typeof raw.userId === 'string' ? raw.userId.trim() : ''
      if (userId.length === 0) {
        errors.push(`player ${index + 1} needs a userId`)
        continue
      }
      if (seen.has(userId)) {
        // would double this person's champion stats for one game
        errors.push(`player ${index + 1} is listed twice`)
        continue
      }
      seen.add(userId)

      const id = championId(raw.championId, `player ${index + 1}'s championId`, errors)

      let role: Role | null = null
      if (raw.role !== undefined && raw.role !== null) {
        if (typeof raw.role !== 'string' || !ROLES.includes(raw.role as Role)) {
          errors.push(`player ${index + 1}'s role must be one of ${ROLES.join(', ')}`)
        } else {
          role = raw.role as Role
        }
      }

      players.push({
        userId,
        championId: id ?? 0, // an error was recorded; the row is unusable either way
        role,
        kills: optionalCount(raw.kills, `player ${index + 1}'s kills`, errors),
        deaths: optionalCount(raw.deaths, `player ${index + 1}'s deaths`, errors),
        assists: optionalCount(raw.assists, `player ${index + 1}'s assists`, errors),
      })
    }
  }

  // --- the enemies, if anybody typed them --------------------------------------------------------
  const opponents: ManualMatchOpponent[] = []
  const rawOpponents = input.opponents
  if (rawOpponents !== undefined && rawOpponents !== null) {
    if (!Array.isArray(rawOpponents)) {
      errors.push('opponents must be a list')
    } else if (rawOpponents.length > MANUAL_OPPONENTS_MAX) {
      errors.push(`no more than ${MANUAL_OPPONENTS_MAX} opponents`)
    } else {
      for (const [index, raw] of rawOpponents.entries()) {
        if (!isRecord(raw)) {
          errors.push(`opponent ${index + 1} is not an object`)
          continue
        }
        // an opponent with no champion would render as an empty cell, which reads as "no opponent"
        const id = championId(raw.championId, `opponent ${index + 1}'s championId`, errors)
        if (id !== null) opponents.push({ championId: id })
      }
    }
  }

  // --- the note ----------------------------------------------------------------------------------
  let note: string | null = null
  if (input.note !== undefined && input.note !== null) {
    if (typeof input.note !== 'string') {
      errors.push('note must be text')
    } else if (input.note.trim().length > MANUAL_NOTE_MAX) {
      // truncated silently would lose what somebody wrote; the form can say "too long"
      errors.push(`note must be at most ${MANUAL_NOTE_MAX} characters`)
    } else {
      const trimmed = input.note.trim()
      note = trimmed.length === 0 ? null : trimmed
    }
  }

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    value: {
      playedAt,
      kind: kind as TaggableKind,
      win: win as boolean,
      players,
      opponents,
      note,
    },
  }
}
