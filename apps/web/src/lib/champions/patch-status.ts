import type { ChampionsDto } from '@lol/api/schema-types'

/**
 * What the header says about the champion cache (hexserve-champion-data.md §5).
 *
 * Two deliberate choices:
 *
 * - **Absolute dates, no `now`.** The chip states facts about the dump ("patch 16.23.1, published
 *   19.11."), not facts about the page ("loaded 5 minutes ago"). A relative label needs a clock, a
 *   rerender timer and a decision about what "checked" means — and it would still be a guess.
 * - **A timezone parameter.** `de-DE` numeric formatting is what the team reads, but the zone is
 *   injected so a test is deterministic and a caller can later show the team's clock instead of the
 *   viewer's. Production passes nothing and gets local time.
 */

export type PatchStatusView =
  | { kind: 'empty' }
  | {
      kind: 'patch'
      /** `previous` means the labels are real but not the newest patch — say so, do not hide it. */
      tone: 'current' | 'previous'
      text: string
      tooltip: string
    }

/** "19.11." — `de-DE` already carries the trailing dot. */
function shortDate(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', timeZone }).format(ms)
}

/** "19.11.2026, 18:40" */
function exactTime(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(ms)
}

export function patchStatusView(dto: ChampionsDto, timeZone?: string): PatchStatusView {
  if (dto.patch === null) return { kind: 'empty' }

  const tone = dto.state === 'current' ? 'current' : 'previous'
  const text = [
    `Patch ${dto.patch}`,
    dto.patchPublishedAt === null ? null : shortDate(dto.patchPublishedAt, timeZone),
    // the patch label alone would read identically one patch behind; the reader is allowed to know
    tone === 'previous' ? 'stale' : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')

  const tooltip = [
    dto.patchPublishedAt === null ? null : `published ${exactTime(dto.patchPublishedAt, timeZone)}`,
    dto.fetchedAt === null ? null : `fetched ${exactTime(dto.fetchedAt, timeZone)}`,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')

  return { kind: 'patch', tone, text, tooltip }
}
