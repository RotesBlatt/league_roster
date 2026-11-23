import { describe, expect, test } from 'bun:test'
import type { ChampionRow } from '../../src/db/schema.ts'
import { flattenChampionLabels } from '../../src/hexserve/read.ts'

/**
 * One label per `championId`, always (hexserve-champion-data.md §4). The two retained patches make
 * per-patch labels *possible*, and this rule is what refuses them: a champion cannot change name
 * in the middle of one list because the game it appeared in was played two weeks earlier. The
 * older patch is a lookup safety net only.
 */

const row = (patch: string, championId: number, name: string): ChampionRow => ({
  patch,
  championId,
  name,
  slug: name.toLowerCase(),
  iconUrl: `https://cdn/${championId}.png`,
  positions: ['MIDDLE'],
  roles: ['MAGE'],
  locale: 'en_US',
})

describe('flattenChampionLabels', () => {
  test('a champion present in both patches is labelled from the newest one', () => {
    const labels = flattenChampionLabels(
      [row('16.23.1', 1, 'Annie'), row('16.24.1', 1, 'Annie (neu)')],
      ['16.24.1', '16.23.1'],
    )

    expect(labels).toHaveLength(1)
    expect(labels[0]?.name).toBe('Annie (neu)')
  })

  test('a champion that vanished from the newest patch still resolves from the previous one', () => {
    const labels = flattenChampionLabels(
      [row('16.23.1', 1, 'Annie'), row('16.23.1', 2, 'Olaf'), row('16.24.1', 1, 'Annie')],
      ['16.24.1', '16.23.1'],
    )

    // the same name and icon for every row that references it, not "unknown" for the odd one out
    expect(labels.map((label) => label.name)).toEqual(['Annie', 'Olaf'])
  })

  test('an id in neither patch is simply absent — the caller renders a placeholder', () => {
    const labels = flattenChampionLabels([row('16.24.1', 1, 'Annie')], ['16.24.1', '16.23.1'])
    expect(labels.map((label) => label.championId)).toEqual([1])
  })

  test('patch order is the caller’s, not the row order the database happened to return', () => {
    const labels = flattenChampionLabels(
      [row('16.23.1', 1, 'Annie old'), row('16.24.1', 1, 'Annie new')],
      ['16.24.1', '16.23.1'],
    )
    expect(labels[0]?.name).toBe('Annie new')
  })

  test('the result is ordered by champion id, so a response is stable between reads', () => {
    const labels = flattenChampionLabels(
      [row('16.24.1', 266, 'Aatrox'), row('16.24.1', 1, 'Annie'), row('16.24.1', 103, 'Ahri')],
      ['16.24.1'],
    )
    expect(labels.map((label) => label.championId)).toEqual([1, 103, 266])
  })

  test('an empty cache flattens to an empty list rather than throwing', () => {
    expect(flattenChampionLabels([], [])).toEqual([])
  })
})
