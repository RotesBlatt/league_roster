import { describe, expect, test } from 'bun:test'
import { composeRoster, normalizeRosterWrite, type RosterSources } from '../../src/lib/roster.ts'

/**
 * The roster read is a join of four things — entry, profile, main account, user — and the rules
 * that decide what a row *says* are worth pinning here rather than inferring from SQL:
 *
 *  - the captain's `roleOverride` wins, the player's preference fills the gap;
 *  - a member without a profile still gets a row (their Discord name), never a blank line;
 *  - only the **main** account is shown, and "unverified" is a value, not a missing row.
 */

const entry = (over: Partial<RosterSources['entries'][number]> = {}) => ({
  id: 'entry-1',
  teamId: 'team-1',
  userId: 'user-1',
  note: null,
  roleOverride: null,
  isActive: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
})

const sources = (over: Partial<RosterSources> = {}): RosterSources => ({
  entries: [entry()],
  profiles: [],
  accounts: [],
  users: [],
  ...over,
})

describe('composeRoster', () => {
  test('the captain’s override wins over the player’s preference', () => {
    const rows = composeRoster(
      sources({
        entries: [entry({ roleOverride: 'SUP' })],
        profiles: [
          {
            userId: 'user-1',
            displayName: 'Jules',
            preferredRole: 'MID',
          },
        ],
      }),
    )

    expect(rows[0]).toMatchObject({ role: 'SUP', displayName: 'Jules' })
  })

  test('without an override the player’s own preference is the position', () => {
    const rows = composeRoster(
      sources({
        profiles: [
          {
            userId: 'user-1',
            displayName: 'Jules',
            preferredRole: 'ADC',
          },
        ],
      }),
    )

    expect(rows[0]?.role).toBe('ADC')
  })

  test('a member without a profile still gets a row, named by their Discord name', () => {
    const rows = composeRoster(
      sources({
        users: [{ id: 'user-1', name: 'julius_dev' }],
      }),
    )

    expect(rows[0]).toMatchObject({ displayName: 'julius_dev', role: null })
  })

  test('the main account is shown; a non-main account is not', () => {
    const rows = composeRoster(
      sources({
        accounts: [
          {
            userId: 'user-1',
            gameName: 'Smurf',
            tagLine: 'EUW',
            isMain: false,
            verifiedAt: null,
          },
          {
            userId: 'user-1',
            gameName: 'Hide on bush',
            tagLine: 'EUW',
            isMain: true,
            verifiedAt: new Date('2026-01-02T03:04:05.000Z'),
          },
        ],
      }),
    )

    expect(rows[0]?.mainAccount).toEqual({
      gameName: 'Hide on bush',
      tagLine: 'EUW',
      verifiedAt: Date.parse('2026-01-02T03:04:05.000Z'),
    })
  })

  test('no main account is null, not an empty label', () => {
    expect(composeRoster(sources())[0]?.mainAccount).toBeNull()
  })

  test('rows are ordered by position, then by name, with unknown positions last', () => {
    const rows = composeRoster(
      sources({
        entries: [
          entry({ id: 'e1', userId: 'u1' }),
          entry({ id: 'e2', userId: 'u2' }),
          entry({ id: 'e3', userId: 'u3' }),
          // TOP by override, no profile at all
          entry({ id: 'e4', userId: 'u4', roleOverride: 'TOP' }),
          // no profile and no override: no position to sort by
          entry({ id: 'e5', userId: 'u5' }),
        ],
        profiles: [
          {
            userId: 'u1',
            displayName: 'Zoe',
            preferredRole: 'JGL',
          },
          {
            userId: 'u2',
            displayName: 'Adam',
            preferredRole: 'JGL',
          },
          {
            userId: 'u3',
            displayName: 'Nobody',
            preferredRole: 'MID',
          },
        ],
        // only u5 has no profile and no override; u4 is TOP by override, u5 sorts last
        users: [{ id: 'u5', name: 'Zed' }],
      }),
    )

    // TOP first (the override counts as a position), then JGL by name, MID, and the row with no
    // position at all last — never guessed into a slot
    expect(rows.map((row) => row.displayName)).toEqual(['Unknown', 'Adam', 'Zoe', 'Nobody', 'Zed'])
  })

  test('the captain-owned fields pass through untouched', () => {
    const rows = composeRoster(
      sources({ entries: [entry({ note: 'shotcaller', isActive: false })] }),
    )

    expect(rows[0]).toMatchObject({ note: 'shotcaller', isActive: false })
  })
})

describe('normalizeRosterWrite', () => {
  test('a blank note becomes null, a real one is trimmed', () => {
    expect(normalizeRosterWrite({ note: '   ' }).values.note).toBeNull()
    expect(normalizeRosterWrite({ note: ' shotcaller ' }).values.note).toBe('shotcaller')
  })

  test('an omitted field stays omitted — a PATCH must not clear what it did not mention', () => {
    const { values } = normalizeRosterWrite({})

    expect(values).toEqual({})
    expect('note' in values).toBe(false)
    expect('roleOverride' in values).toBe(false)
    expect('isActive' in values).toBe(false)
  })

  test('an explicit null is how the captain clears the override', () => {
    expect(normalizeRosterWrite({ roleOverride: null }).values.roleOverride).toBeNull()
  })

  test('a known role is accepted, an unknown one is a field problem', () => {
    expect(normalizeRosterWrite({ roleOverride: 'SUP' }).values.roleOverride).toBe('SUP')
    expect(normalizeRosterWrite({ roleOverride: 'JUNGLE' }).problems).toEqual([
      { field: 'roleOverride', message: 'Unknown role' },
    ])
  })

  test('isActive passes through untouched', () => {
    expect(normalizeRosterWrite({ isActive: false }).values.isActive).toBe(false)
  })
})
