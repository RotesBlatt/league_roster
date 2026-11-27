import type { MatchGameDto, PlayerStatsDto } from '@lol/api/schema-types'
import { ROLE_LABELS } from '@lol/shared'

/**
 * The stats page's cells (match-history.md §8, §9) — plain functions, no React.
 *
 * One rule runs through all of them: **a number we do not have renders `–`, never `0`**. A
 * hand-entered scrim has no CS and no duration; a player who has never played has no winrate. The
 * page must be able to say "we do not know" without inventing a value, and these are the only place
 * that decision is made.
 */

/** `25.11.2026`, assembled from parts so the output does not depend on a locale's separator. */
export function formatStatsDate(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '–'
  const instant = new Date(iso)
  if (Number.isNaN(instant.getTime())) return '–'

  const parts = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone,
  }).formatToParts(instant)
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? ''

  return `${part('day')}.${part('month')}.${part('year')}`
}

/** `64%`, or `–` when there is nothing to divide — `0%` from no games is a lie. */
export function formatWinrate(winrate: number | null): string {
  return winrate === null ? '–' : `${winrate}%`
}

/** `9 / 5` — the sheet's spacing, so the two numbers read as one value. */
export function formatWinsLosses(wins: number, losses: number): string {
  return `${wins} / ${losses}`
}

/** Whole minutes. A hand-entered row has no duration, and that is a dash, not `0 Min`. */
export function minutesLabel(durationSeconds: number | null): string {
  if (durationSeconds === null) return '–'
  return `${Math.round(durationSeconds / 60)} Min`
}

/**
 * The game log's stats cell: `1/4/22 KDA · 201 CS · 35 Min · Mid`.
 *
 * Every part is optional and the unknown ones are **dropped**, not printed as `–`: a scrim with no
 * KDA should read `Mid`, not `– KDA · – CS · – Min · Mid`. If nothing at all is known the cell is a
 * single dash, so it never looks like a broken row.
 */
export function gameLine(game: MatchGameDto, _timeZone?: string): string {
  const parts: string[] = []

  if (game.kills !== null && game.deaths !== null && game.assists !== null) {
    parts.push(`${game.kills}/${game.deaths}/${game.assists} KDA`)
  }
  if (game.cs !== null) parts.push(`${game.cs} CS`)
  if (game.durationSeconds !== null) parts.push(minutesLabel(game.durationSeconds))
  if (game.role !== null) parts.push(ROLE_LABELS[game.role])

  return parts.length === 0 ? '–' : parts.join(' · ')
}

/** The four cards above a player's table: games, winrate, record, last played. */
export function playerKpis(player: PlayerStatsDto): {
  games: string
  winrate: string
  record: string
  lastPlayed: string
} {
  return {
    // zero games is a real zero here: "you have not played" is a fact, unlike a 0% winrate
    games: String(player.games),
    winrate: formatWinrate(player.winrate),
    record: formatWinsLosses(player.wins, player.losses),
    lastPlayed: formatStatsDate(player.lastPlayedAt),
  }
}
