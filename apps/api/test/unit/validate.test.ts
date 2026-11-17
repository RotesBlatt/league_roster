import { describe, expect, test } from 'bun:test'
import {
  inviteCode,
  memberStatusSchema,
  roleSchema,
  userRoleSchema,
} from '../../src/lib/validate.ts'

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

describe('inviteCode', () => {
  test('is 8 characters by default', () => {
    expect(inviteCode()).toHaveLength(8)
  })

  test('honours a custom length', () => {
    expect(inviteCode(4)).toHaveLength(4)
    expect(inviteCode(24)).toHaveLength(24)
  })

  test('only uses url-safe characters', () => {
    for (let i = 0; i < 200; i++) {
      expect(inviteCode()).toMatch(/^[a-z2-9]+$/)
    }
  })

  test('avoids characters that get misread (0 1 l o)', () => {
    const generated = Array.from({ length: 200 }, () => inviteCode()).join('')
    for (const ambiguous of ['0', '1', 'l', 'o']) {
      expect(generated).not.toContain(ambiguous)
    }
  })

  test('stays inside the declared alphabet', () => {
    for (const char of inviteCode(64)) {
      expect(ALPHABET).toContain(char)
    }
  })

  test('does not repeat itself', () => {
    const codes = new Set(Array.from({ length: 500 }, () => inviteCode()))
    expect(codes.size).toBe(500)
  })
})

describe('enum schemas', () => {
  // t.UnionEnum hardcodes `default: values[0]`, and Elysia applies defaults to objects.
  // A PATCH of { status: 'active' } therefore used to write role: 'captain', and a player
  // PATCH used to rewrite role to 'TOP'. Omitted properties must stay omitted.
  test('carry no default value', () => {
    expect(roleSchema.default).toBeUndefined()
    expect(memberStatusSchema.default).toBeUndefined()
    expect(userRoleSchema.default).toBeUndefined()
  })
})
