import { describe, expect, test } from 'bun:test'
import type { ChampionLabelDto } from '@lol/api/schema-types'
import { normalizeChampionQuery, searchChampions } from '../../../src/lib/champions/search.ts'

/**
 * The champion picker's search (champion-pools.md §7 — "searchable by name and slug").
 *
 * League names are punctuation and diacritics: `Kai'Sa`, `K'Sante`, `Nunu & Willump`, `Kha'Zix`.
 * A search that requires the apostrophe is a search that fails on the champion the user is trying
 * to add, so normalisation is the whole feature and worth a test rather than a `toLowerCase()`.
 */

const champion = (championId: number, name: string, slug: string): ChampionLabelDto => ({
  championId,
  name,
  slug,
  iconUrl: `https://cdn/${championId}.png`,
  positions: [],
  roles: [],
})

const KAI_SA = champion(145, "Kai'Sa", 'kaisa')
const KSANTE = champion(897, "K'Sante", 'ksante')
const NUNU = champion(20, 'Nunu & Willump', 'nunu')
const KHAZIX = champion(121, "Kha'Zix", 'khazix')
const AHRI = champion(103, 'Ahri', 'ahri')
const AZIR = champion(268, 'Azir', 'azir')
const LEE_SIN = champion(64, 'Lee Sin', 'leesin')
const ALL = [KAI_SA, KSANTE, NUNU, KHAZIX, AHRI, AZIR, LEE_SIN]

const ids = (result: ChampionLabelDto[]) => result.map((entry) => entry.championId)

describe('normalizeChampionQuery', () => {
  test('case, apostrophes, spaces and other punctuation do not matter', () => {
    expect(normalizeChampionQuery("Kai'Sa")).toBe('kaisa')
    expect(normalizeChampionQuery('K Sante')).toBe('ksante')
    expect(normalizeChampionQuery('Nunu & Willump')).toBe('nunuwillump')
    expect(normalizeChampionQuery('  Ahri  ')).toBe('ahri')
  })

  test('diacritics are folded, so "Ryze" finds "Ryzé" (should the dump ever use one)', () => {
    expect(normalizeChampionQuery('Ryzé')).toBe('ryze')
  })
})

describe('searchChampions', () => {
  test('an apostrophe-free query finds the champion', () => {
    expect(ids(searchChampions(ALL, 'kaisa'))).toEqual([145])
    expect(ids(searchChampions(ALL, 'ksante'))).toEqual([897])
    expect(ids(searchChampions(ALL, 'khazix'))).toEqual([121])
  })

  test('the name as printed works too', () => {
    expect(ids(searchChampions(ALL, "Kai'Sa"))).toEqual([145])
    expect(ids(searchChampions(ALL, 'lee sin'))).toEqual([64])
  })

  test('partial queries match from the start of the name before anywhere else', () => {
    // five of the seven contain an "a" (Nunu & Willump and Lee Sin do not); Ahri and Azir start
    // with it, so they must come first whatever the alphabetical order would say
    const result = ids(searchChampions(ALL, 'a'))
    expect(result).toHaveLength(5)
    expect(result.slice(0, 2)).toEqual([103, 268])
    expect(result.slice(2).sort()).toEqual([121, 145, 897])
  })

  test('matches on the slug as well as the name', () => {
    expect(ids(searchChampions([NUNU], 'nunu'))).toEqual([20])
  })

  test('nothing matches: an empty list, not a fallback list', () => {
    expect(searchChampions(ALL, 'zzzz')).toEqual([])
  })

  test('an empty query lists the cache by name, so the picker is never blank', () => {
    expect(ids(searchChampions(ALL, ''))).toEqual(
      [103, 268, 64, 145, 897, 121, 20].sort((a, b) => {
        const byId = new Map(ALL.map((entry) => [entry.championId, entry.name]))
        return String(byId.get(a)).localeCompare(String(byId.get(b)))
      }),
    )
  })

  test('the initial list is the whole cache, not the first page of it', () => {
    // the picker opens on every champion: a truncated list reads as "the others are missing"
    const many = Array.from({ length: 50 }, (_, index) =>
      champion(index + 1, `Champion ${index + 1}`, `champion${index + 1}`),
    )
    expect(searchChampions(many, '')).toHaveLength(50)
  })

  test('an explicit limit is still honoured, for callers that want one', () => {
    expect(searchChampions(ALL, '', 3)).toHaveLength(3)
  })
})
