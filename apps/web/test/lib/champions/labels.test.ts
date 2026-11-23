import { describe, expect, test } from 'bun:test'
import type { ChampionLabelDto } from '@lol/api/schema-types'
import { championLabelFor, unknownChampionName } from '../../../src/lib/champions/labels.ts'

/**
 * The SPA's champion lookup (hexserve-champion-data.md §4, §7). It is a pure function over the
 * payload on purpose: rendering a label must never be able to fail a page, so the "what do we show
 * for this id" decision is testable without a component, a query or a network.
 */

const annie: ChampionLabelDto = {
  championId: 1,
  name: 'Annie',
  slug: 'annie',
  iconUrl: 'https://cdn/1.png',
  positions: ['MIDDLE'],
  roles: ['MAGE'],
}

const aatrox: ChampionLabelDto = {
  championId: 266,
  name: 'Aatrox',
  slug: 'aatrox',
  iconUrl: 'https://cdn/266.png',
  positions: ['TOP'],
  roles: ['FIGHTER'],
}

describe('championLabelFor', () => {
  test('resolves an id to the label the server flattened for it', () => {
    expect(championLabelFor([annie, aatrox], 266)).toEqual(aatrox)
  })

  test('an id the dump does not know is null, never a throw', () => {
    expect(championLabelFor([annie], 9001)).toBeNull()
  })

  test('an empty or absent list is the same answer: no label', () => {
    expect(championLabelFor([], 1)).toBeNull()
    expect(championLabelFor(undefined, 1)).toBeNull()
  })

  test('the ids are numbers, not strings — Riot match data is numeric', () => {
    // a string id would silently match nothing here and render a placeholder everywhere
    expect(championLabelFor([annie], 1)).not.toBeNull()
  })
})

describe('unknownChampionName', () => {
  test('shows the id, so an unknown champion is diagnosable rather than blank', () => {
    expect(unknownChampionName(266)).toBe('Champion #266')
  })
})
