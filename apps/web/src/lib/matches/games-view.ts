import type { MatchLaneRefDto } from '@lol/api/schema-types'
import type { MatchKind } from '@lol/shared'

/**
 * How a game row reads in the log (match-history.md §9) — plain functions, no React.
 *
 * **What is left after the games list became the stats views.** The page that needed a scope
 * selector, `3/5` counts, KDA strings and per-game grouping was replaced, and its helpers went with
 * it rather than lingering as exports nobody calls — dead code with passing tests is the kind that
 * gets trusted by mistake later.
 *
 * What survives is what the log and the lane cells actually use.
 */

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
 * The result's colour, as **theme tokens** rather than Mantine colour names.
 *
 * `c="green"` picks whatever shade Mantine's default palette happens to call green; a token names
 * the *meaning*, so a future palette (`ui-rework`) can change every tone in one file.
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

/** `S` / `N`, and `–` when nobody recorded a result (a hand-entered row with no outcome). */
export function resultText(win: boolean | null): string {
  if (win === null) return '–'
  return win ? 'S' : 'N'
}

/**
 * What a lane cell should render — a decision, not a string.
 *
 * It once returned `"Champion 24"` for an enemy, which is a placeholder, not a label: the component
 * has the champion cache and can render the real name and icon. Returning the **id** keeps that
 * decision where the cache lives, while this stays pure and testable.
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
