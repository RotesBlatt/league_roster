import type { MatchGameDto, MatchLaneRefDto } from '@lol/api/schema-types'
import type { MatchKind, MatchScope, MatchSource } from '@lol/shared'

/**
 * How a games row reads (match-history.md §9) — plain functions, no React.
 *
 * The rules live here rather than in the page because each one is a way to lie with a rendered
 * cell: `0/0/0` for a scrim that recorded no KDA, five rows of one game read as five games, or a
 * `5/10` that means nothing to somebody looking at *their* team. The page arranges; this decides.
 */

/**
 * The toolbar's scope list. Ordered like the sheet's `TYP` selector, and deliberately the six the
 * doc names — `normal`, `custom` and `other` exist as kinds but are not tabs (§9).
 */
export const GAMES_SCOPE_OPTIONS: readonly { value: MatchScope; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'solo', label: 'SoloQ' },
  { value: 'flex', label: 'Flex' },
  { value: 'ranked5', label: 'Ranked 5v5' },
  { value: 'scrim', label: 'Scrim' },
  { value: 'tournament', label: 'Tournament' },
]

const KIND_LABELS = {
  solo: 'SoloQ',
  flex: 'Flex',
  ranked5: 'Ranked 5v5',
  normal: 'Normal',
  custom: 'Custom',
  tournament: 'Tournament',
  scrim: 'Scrim',
  other: 'Other',
} satisfies Record<MatchKind, string>

export function kindLabel(kind: MatchKind): string {
  return KIND_LABELS[kind]
}

/**
 * The §9 provenance badge. A code-ingested tournament game will say `Turnier-Code` when that
 * ingest exists; until then a Riot row is `Riot` and a typed one is `manuell`, so nobody reads a
 * missing league game as a game that never happened.
 */
export function provenanceLabel(provenance: MatchSource): string {
  return provenance === 'riot' ? 'Riot' : 'Manual'
}

/**
 * The result's colour, as **theme tokens** rather than Mantine colour names.
 *
 * `c="green"` picks whatever shade Mantine's default palette happens to call green; a token names
 * the *meaning*, so a future palette (`ui-rework`) can change every tone in one file. This is the
 * one place the games list decides what win/loss look like — the same shape `badges.tsx` uses for
 * statuses.
 */
export const RESULT_TONE = {
  win: 'var(--mantine-color-teal-6)',
  loss: 'var(--mantine-color-red-6)',
  unknown: 'var(--mantine-color-dimmed)',
} as const

export function resultTone(win: boolean | null): string {
  if (win === null) return RESULT_TONE.unknown
  return win ? RESULT_TONE.win : RESULT_TONE.loss
}

/** `–` is the whole point: a missing number is not a zero, and the two must not look alike. */
export function formatKda(game: Pick<MatchGameDto, 'kills' | 'deaths' | 'assists'>): string {
  if (game.kills === null || game.deaths === null || game.assists === null) return '–'
  return `${game.kills}/${game.deaths}/${game.assists}`
}

export function resultText(win: boolean | null): string {
  if (win === null) return '–'
  return win ? 'S' : 'N'
}

/**
 * What a lane cell should render — a decision, not a string.
 *
 * It used to return `"Champion 24"` for an enemy, which is a placeholder, not a label: the page has
 * the champion cache and can render the real name and icon. Returning the **id** keeps that decision
 * in the component (where the cache lives) while this stays pure and testable.
 *
 * A teammate has a name; an enemy usually has only a champion, because we store puuids and hold no
 * account for them (§5.6). Nothing known is an empty cell — never an invented champion.
 */
export type LaneCell =
  | { kind: 'none' }
  | { kind: 'name'; name: string }
  | { kind: 'champion'; championId: number }

export function laneCell(ref: MatchLaneRefDto | null): LaneCell {
  if (!ref) return { kind: 'none' }
  if (ref.displayName) return { kind: 'name', name: ref.displayName }
  if (ref.championId !== null) return { kind: 'champion', championId: ref.championId }
  return { kind: 'none' }
}

/** `3/5` of **our** side, never `5/10` of the lobby (§7). */
export function teamCountText(count: number): string {
  return `${count}/5`
}

/**
 * The team's wall clock (§5.3 is the opposite decision for storage, on purpose): the instant is
 * UTC, the reader is not. Assembled from parts so the output does not depend on the browser's
 * locale — `de-DE` alone would print `09.11., 20:15` and the comma is not what the sheet shows.
 */
export function formatGameTime(iso: string, timeZone?: string): string {
  const instant = new Date(iso)
  if (Number.isNaN(instant.getTime())) return '–'

  const parts = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(instant)
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? ''

  return `${part('day')}.${part('month')}. ${part('hour')}:${part('minute')}`
}

/**
 * One game is one game: the sheet repeats `09.11.2026 Flex` five times, once per participant, and
 * five identical date cells read as five games. Grouping is a **rendering** concern (§1) — the page
 * draws one header per group and the players beneath it.
 *
 * Input order is preserved in both levels: the API already sorts newest-first, and re-sorting here
 * would be a second opinion about the same data.
 */
export function groupByMatch(
  games: readonly MatchGameDto[],
): { matchId: string; rows: MatchGameDto[] }[] {
  const groups: { matchId: string; rows: MatchGameDto[] }[] = []
  const byId = new Map<string, { matchId: string; rows: MatchGameDto[] }>()

  for (const game of games) {
    const existing = byId.get(game.matchId)
    if (existing) {
      existing.rows.push(game)
      continue
    }
    const group = { matchId: game.matchId, rows: [game] }
    byId.set(game.matchId, group)
    groups.push(group)
  }

  return groups
}
