import type { RiotAccountDto } from '../db/schema.types.ts'

/**
 * A Riot ID is `gameName#tagLine` — the label a player recognises. It is **not** an identity:
 * renames change it, and `puuid` (once validation exists) is what stays stable (riot-api.md §2).
 *
 * These rules only keep the label usable: trimmed, present, bounded. Riot's real limits are
 * deliberately *not* copied from memory here — `player-profiles.md` §3 says to take them from the
 * live docs, and that happens when the client lands. Until then these are generous upper bounds.
 */
export const RIOT_GAME_NAME_MAX = 32
export const RIOT_TAG_LINE_MAX = 16

export type RiotAccountId = {
  gameName: string
  tagLine: string
}

export type RiotAccountIdProblem = {
  field: 'gameName' | 'tagLine'
  message: string
}

export type NormalizedRiotAccountId = {
  /** Best effort, trimmed: a reported field still has a safe value for the insert path. */
  values: RiotAccountId
  problems: RiotAccountIdProblem[]
}

export function normalizeRiotAccountId(input: RiotAccountId): NormalizedRiotAccountId {
  const gameName = input.gameName.trim()
  const tagLine = input.tagLine.trim()
  const problems: RiotAccountIdProblem[] = []

  if (gameName.length === 0) {
    problems.push({ field: 'gameName', message: 'Game name is required' })
  } else if (gameName.length > RIOT_GAME_NAME_MAX) {
    problems.push({
      field: 'gameName',
      message: `Game name must be at most ${RIOT_GAME_NAME_MAX} characters`,
    })
  }

  if (tagLine.length === 0) {
    problems.push({ field: 'tagLine', message: 'Tag line is required' })
  } else if (tagLine.length > RIOT_TAG_LINE_MAX) {
    problems.push({
      field: 'tagLine',
      message: `Tag line must be at most ${RIOT_TAG_LINE_MAX} characters`,
    })
  }

  return { values: { gameName, tagLine }, problems }
}

/**
 * Row → wire shape. `puuid` and `fetchedAt` stay internal: the UI has nothing to do with them,
 * and `verifiedAt === null` is the badge it *does* care about.
 */
export function toRiotAccountDto(row: {
  id: string
  gameName: string
  tagLine: string
  platform: string
  isMain: boolean
  verifiedAt: Date | null
}): RiotAccountDto {
  return {
    id: row.id,
    gameName: row.gameName,
    tagLine: row.tagLine,
    platform: row.platform,
    isMain: row.isMain,
    verifiedAt: row.verifiedAt?.getTime() ?? null,
  }
}
