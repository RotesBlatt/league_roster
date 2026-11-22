import { describe, expect, test } from 'bun:test'
import type { MemberDto, RosterEntryDto } from '@lol/api/schema-types'
import {
  accountOptions,
  defaultAccountId,
  pickableMembers,
} from '../../../src/lib/team/roster-form.ts'

/**
 * The captain's choices, without a DOM: who can be added, which accounts he may pick from, and
 * which one starts selected. The API still validates ownership — this only fills the form.
 */
const account = (id: string, gameName: string, isMain = false) => ({
  id,
  gameName,
  tagLine: 'EUW',
  isMain,
})

const member = (id: string, name: string, accounts: MemberDto['accounts'] = []): MemberDto => ({
  id,
  name,
  email: `${id}@test.local`,
  image: null,
  role: 'member',
  status: 'active',
  teamId: 't1',
  createdAt: 0,
  hasRosterEntry: false,
  accounts,
})

const entry = (userId: string): RosterEntryDto => ({
  id: `entry-${userId}`,
  userId,
  displayName: 'x',
  role: null,
  note: null,
  isActive: true,
  account: null,
})

describe('pickableMembers', () => {
  test('leaves out anyone already on the roster', () => {
    const members = [member('u1', 'Jules'), member('u2', 'Extra')]

    expect(pickableMembers(members, [entry('u1')]).map((m) => m.id)).toEqual(['u2'])
  })
})

describe('accountOptions', () => {
  test('offers every account of that member, the main one marked', () => {
    const jules = member('u1', 'Jules', [account('a1', 'Main', true), account('a2', 'Smurf')])

    expect(accountOptions(jules)).toEqual([
      { value: 'a1', label: 'Main#EUW · main' },
      { value: 'a2', label: 'Smurf#EUW' },
    ])
  })

  test('no member means nothing to pick', () => {
    expect(accountOptions(undefined)).toEqual([])
  })
})

describe('defaultAccountId', () => {
  test('preselects his main account — the captain may still choose another', () => {
    expect(defaultAccountId(member('u1', 'Jules', [account('a1', 'Main', true)]))).toBe('a1')
  })

  test('a member without accounts preselects nothing, and can still be added', () => {
    expect(defaultAccountId(member('u1', 'Jules'))).toBeNull()
    expect(defaultAccountId(undefined)).toBeNull()
  })
})
