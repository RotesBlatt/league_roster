import { describe, expect, test } from 'bun:test'
import type { ChampionsDto } from '@lol/api/schema-types'
import { patchStatusView } from '../../../src/lib/champions/patch-status.ts'

/**
 * What the header says about the champion cache (hexserve-champion-data.md §5).
 *
 * The three states must be distinguishable — `current` and `previous` are the same labels but a
 * different claim to the reader — and the dates must be **absolute and deterministic**: the chip is
 * a statement about the dump, not about how long ago the page was loaded, so there is no `now` here
 * and no relative "5 minutes ago" to drift.
 *
 * A timezone is injected so assertions do not depend on the machine running the tests; production
 * passes nothing and gets the viewer's local clock.
 */

const snapshot = (overrides: Partial<ChampionsDto> = {}): ChampionsDto => ({
  patch: '16.23.1',
  previousPatch: '16.22.1',
  // 2026-11-19T18:40:23.358Z
  patchPublishedAt: 1_795_113_623_358,
  // 2026-11-19T18:45:00.000Z
  fetchedAt: 1_795_113_900_000,
  state: 'current',
  champions: [],
  ...overrides,
})

describe('patchStatusView', () => {
  test('the current patch reads as patch plus the day it was published', () => {
    const view = patchStatusView(snapshot(), 'UTC')

    expect(view).toMatchObject({
      kind: 'patch',
      tone: 'current',
      text: 'Patch 16.23.1 · 19.11.',
    })
  })

  test('the tooltip carries both exact instants, so "why does it say that" is answerable', () => {
    const view = patchStatusView(snapshot(), 'UTC')

    expect(view.kind === 'patch' && view.tooltip).toContain('19.11.2026')
    expect(view.kind === 'patch' && view.tooltip).toContain('18:40')
    expect(view.kind === 'patch' && view.tooltip).toContain('18:45')
  })

  test('the same labels from an older patch are marked stale, not silently identical', () => {
    const view = patchStatusView(snapshot({ state: 'previous' }), 'UTC')

    expect(view).toMatchObject({ kind: 'patch', tone: 'previous' })
    expect(view.kind === 'patch' && view.text).toContain('stale')
  })

  test('no cache at all is its own answer, not a patch with a blank date', () => {
    expect(
      patchStatusView(snapshot({ patch: null, state: 'empty', patchPublishedAt: null }), 'UTC'),
    ).toEqual({ kind: 'empty' })
  })

  test('a patch row without a publication date still renders the patch, minus the date', () => {
    const view = patchStatusView(snapshot({ patchPublishedAt: null }), 'UTC')

    expect(view).toMatchObject({ kind: 'patch', text: 'Patch 16.23.1' })
  })

  test('the date follows the injected zone, so it can be shown where the team lives', () => {
    // 18:40Z is 19:40 in Berlin — the day is the same, the tooltip time is not
    const view = patchStatusView(snapshot(), 'Europe/Berlin')

    expect(view.kind === 'patch' && view.tooltip).toContain('19:40')
  })
})
