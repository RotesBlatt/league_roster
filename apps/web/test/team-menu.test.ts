import { describe, expect, test } from 'bun:test'
import type { TeamSummary } from '@lol/api/schema-types'
import { currentTeam, otherTeams } from '../src/team-menu.ts'

const team = (slug: string, name: string, shortName: string | null = null): TeamSummary => ({
  id: `id-${slug}`,
  slug,
  name,
  shortName,
  role: 'member',
})

const teams = [team('alpha', 'Alpha', 'AL'), team('bravo', 'Bravo'), team('charlie', 'Charlie')]

/**
 * The switcher's derived state: which team the header names, and which ones the menu offers.
 * Kept apart from the Menu component, which is only rendering.
 */
describe('currentTeam', () => {
  test('finds the team the URL names', () => {
    expect(currentTeam(teams, 'bravo')?.name).toBe('Bravo')
  })

  test('is null when the slug is not one of mine', () => {
    // a stale link, or a membership that was disabled while the tab was open
    expect(currentTeam(teams, 'deleted-team')).toBeNull()
  })

  test('is null without a slug at all', () => {
    expect(currentTeam(teams, null)).toBeNull()
  })
})

describe('otherTeams', () => {
  test('leaves out the team I am looking at', () => {
    expect(otherTeams(teams, 'alpha').map((entry) => entry.slug)).toEqual(['bravo', 'charlie'])
  })

  test('keeps the API’s order', () => {
    expect(otherTeams(teams, 'charlie').map((entry) => entry.slug)).toEqual(['alpha', 'bravo'])
  })

  test('offers everything when the current team is unknown', () => {
    expect(otherTeams(teams, 'nope').map((entry) => entry.slug)).toEqual([
      'alpha',
      'bravo',
      'charlie',
    ])
  })
})
