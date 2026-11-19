import { describe, expect, test } from 'bun:test'
import {
  canManageTeam,
  MEMBER_STATUSES,
  ROLE_LABELS,
  ROLES,
  TIERS,
  USER_ROLES,
} from '../src/index.ts'

describe('canManageTeam', () => {
  test('only an active captain may manage the team', () => {
    expect(canManageTeam({ role: 'captain', status: 'active' })).toBe(true)
  })

  test('a disabled captain cannot manage the team', () => {
    expect(canManageTeam({ role: 'captain', status: 'disabled' })).toBe(false)
  })

  test('a disabled captain cannot manage the team', () => {
    expect(canManageTeam({ role: 'captain', status: 'disabled' })).toBe(false)
  })

  test('a regular member cannot manage the team', () => {
    expect(canManageTeam({ role: 'member', status: 'active' })).toBe(false)
  })

  test('no user at all cannot manage the team', () => {
    expect(canManageTeam(null)).toBe(false)
  })
})

describe('role constants', () => {
  test('every role has a label', () => {
    for (const role of ROLES) {
      expect(ROLE_LABELS[role].length).toBeGreaterThan(0)
    }
  })

  test('roles are unique', () => {
    expect(new Set(ROLES).size).toBe(ROLES.length)
  })

  test('statuses and user roles are the expected sets', () => {
    expect([...MEMBER_STATUSES]).toEqual(['active', 'disabled'])
    expect([...USER_ROLES]).toEqual(['captain', 'member'])
  })

  test('tiers are ordered lowest to highest (Riot API order)', () => {
    expect(TIERS[0]).toBe('IRON')
    expect(TIERS[TIERS.length - 1]).toBe('CHALLENGER')
  })
})
