import { describe, expect, test } from 'bun:test'
import type { PatchHistoryEntry } from '@lol/shared'
import {
  championCacheState,
  needsRefresh,
  RETAINED_PATCHES,
  retainNewestTwo,
} from '../../src/hexserve/rules.ts'

/**
 * The three pure rules that keep the champion cache honest (hexserve-champion-data.md §4, §5).
 *
 * They live here, not in `@lol/shared`: the refresh runs in the API and the endpoint resolves the
 * state server-side (§6), so there is exactly one consumer. Only the vocabulary the wire names —
 * `PatchHistoryEntry`, `ChampionCacheState` — is shared.
 */

const patch = (version: string, timestamp: number): PatchHistoryEntry => ({
  version,
  lastUpdate: new Date(timestamp).toISOString(),
  timestamp,
})

describe('retainNewestTwo', () => {
  test('keeps exactly two, newest first, from a longer history', () => {
    expect(
      retainNewestTwo([patch('16.24.1', 300), patch('16.25.1', 400), patch('16.23.1', 200)]),
    ).toEqual(['16.25.1', '16.24.1'])
  })

  test('retention is two patches — a release cycle, not an archive', () => {
    expect(RETAINED_PATCHES).toBe(2)
    expect(
      retainNewestTwo([patch('16.25.1', 400), patch('16.24.1', 300), patch('16.23.1', 200)]),
    ).toHaveLength(RETAINED_PATCHES)
  })

  test('one patch, or none, is answered without inventing rows', () => {
    expect(retainNewestTwo([])).toEqual([])
    expect(retainNewestTwo([patch('16.23.1', 100)])).toEqual(['16.23.1'])
  })

  /**
   * The trap that fails silently: `16.9.1` sorts *after* `16.10.1` as text, so a string comparison
   * would keep the older patch and prune the newer one on the next refresh (§5, trap #2).
   */
  test('orders by timestamp, not by version string', () => {
    const lyingOrder = [patch('16.9.1', 100), patch('16.10.1', 200), patch('16.20.1', 300)]
    expect(retainNewestTwo(lyingOrder)).toEqual(['16.20.1', '16.10.1'])
    expect(retainNewestTwo([patch('16.10.1', 200), patch('16.9.1', 100)])).toEqual([
      '16.10.1',
      '16.9.1',
    ])
  })

  test('the input array is left alone', () => {
    const history = [patch('16.23.1', 100), patch('16.24.1', 200)]
    const before = history.map((entry) => entry.version)
    retainNewestTwo(history)
    expect(history.map((entry) => entry.version)).toEqual(before)
  })

  test('a version listed twice is one patch, not two of the two slots', () => {
    expect(retainNewestTwo([patch('16.24.1', 200), patch('16.24.1', 100)])).toEqual(['16.24.1'])
  })
})

describe('needsRefresh', () => {
  test('a patch we do not hold is fetched', () => {
    expect(needsRefresh(['16.23.1'], '16.24.1')).toBe(true)
  })

  test('an empty cache is always fetched', () => {
    expect(needsRefresh([], '16.24.1')).toBe(true)
  })

  test('the patch we already hold is not fetched again — a version comparison, not a TTL', () => {
    expect(needsRefresh(['16.24.1', '16.23.1'], '16.24.1')).toBe(false)
    expect(needsRefresh(['16.24.1'], '16.24.1')).toBe(false)
  })

  test('an unreachable dump keeps what we have: no version, no fetch, no empty table', () => {
    expect(needsRefresh(['16.23.1'], null)).toBe(false)
    expect(needsRefresh([], null)).toBe(false)
  })
})

describe('championCacheState', () => {
  test('no rows at all is empty — ids and placeholders, never an error', () => {
    expect(championCacheState([], '16.24.1')).toBe('empty')
    expect(championCacheState([], null)).toBe('empty')
  })

  test('holding the dump’s current patch is current', () => {
    expect(championCacheState(['16.24.1', '16.23.1'], '16.24.1')).toBe('current')
  })

  test('holding something older is previous — labels still render, one log line', () => {
    expect(championCacheState(['16.23.1'], '16.24.1')).toBe('previous')
  })

  test('an unreachable dump is previous too: rows we hold, just not the newest one', () => {
    expect(championCacheState(['16.23.1'], null)).toBe('previous')
  })
})
