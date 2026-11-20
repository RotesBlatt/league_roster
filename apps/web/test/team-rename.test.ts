import { describe, expect, test } from 'bun:test'
import { SHORT_NAME_MAX, TEAM_NAME_MAX } from '@lol/shared'
import { draftRename } from '../src/team-rename.ts'

/**
 * The admin page's rename form, without a DOM: what to send, whether anything changed, and
 * what a refusal means to a human. The API stays authoritative — these checks only save a
 * round trip (team-rename.md §4).
 */
describe('draftRename', () => {
  const current = { currentName: 'Alte Garde', currentShortName: 'AG' }

  test('trims both fields', () => {
    expect(draftRename({ ...current, name: '  Neue Welle ', shortName: ' NW ' })).toEqual({
      ok: true,
      body: { name: 'Neue Welle', shortName: 'NW' },
      unchanged: false,
    })
  })

  // the API reads a blank short name as "clear it", which only works if '' is actually sent
  test('sends an emptied short name as an empty string instead of dropping it', () => {
    expect(draftRename({ ...current, name: 'Neue Welle', shortName: '  ' })).toEqual({
      ok: true,
      body: { name: 'Neue Welle', shortName: '' },
      unchanged: false,
    })
  })

  test('a save with nothing edited is still a valid draft, but flagged unchanged', () => {
    expect(draftRename({ ...current, name: ' Alte Garde ', shortName: 'AG' })).toMatchObject({
      ok: true,
      unchanged: true,
    })
  })

  // a team without a tag must reach "unchanged" from an empty field
  test('an untouched empty short name against no current one is unchanged', () => {
    expect(
      draftRename({
        currentName: 'Ohne Tag',
        currentShortName: null,
        name: 'Ohne Tag',
        shortName: '',
      }),
    ).toMatchObject({ ok: true, unchanged: true })
  })

  test('changing only the short name counts as a change', () => {
    expect(draftRename({ ...current, name: 'Alte Garde', shortName: 'NEU' })).toMatchObject({
      ok: true,
      unchanged: false,
    })
  })

  test('changing only the letter case of the name counts as a change', () => {
    expect(draftRename({ ...current, name: 'ALTE GARDE', shortName: 'AG' })).toMatchObject({
      ok: true,
      unchanged: false,
    })
  })

  test('clearing a tag that exists counts as a change', () => {
    expect(draftRename({ ...current, name: 'Alte Garde', shortName: '' })).toMatchObject({
      ok: true,
      unchanged: false,
    })
  })

  test('refuses a blank name without asking the API', () => {
    const draft = draftRename({ ...current, name: '   ', shortName: 'AG' })
    expect(draft).toMatchObject({ ok: false })
    if (!draft.ok) expect(draft.message.toLowerCase()).toContain('name')
  })

  test('refuses names the API would reject as too long', () => {
    expect(
      draftRename({ ...current, name: 'a'.repeat(TEAM_NAME_MAX + 1), shortName: 'AG' }),
    ).toMatchObject({ ok: false })
    expect(
      draftRename({ ...current, name: 'Alte Garde', shortName: 'a'.repeat(SHORT_NAME_MAX + 1) }),
    ).toMatchObject({ ok: false })
  })

  test('accepts exactly at the limits', () => {
    expect(
      draftRename({
        currentName: 'x',
        currentShortName: null,
        name: 'a'.repeat(TEAM_NAME_MAX),
        shortName: 'a'.repeat(SHORT_NAME_MAX),
      }),
    ).toMatchObject({ ok: true })
  })
})
