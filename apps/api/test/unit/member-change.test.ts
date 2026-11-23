import { describe, expect, test } from 'bun:test'
import { decideMemberChange, type MemberChangeInput } from '../../src/lib/member-change.ts'

/**
 * Two rules live between a captain and `/members/:id`: you may not lock yourself out, and the team
 * may not lose its last captain. Both are about a *pair* of rows (actor+target, target+the rest of
 * the team), which is exactly why they are decided here and not inside the PATCH handler
 * (AGENTS.md: "a route handler that thinks is a route handler that can't be tested").
 *
 * `activeCaptainCount` is passed in rather than queried, so these tests need no database: the count
 * is a fact about the team, the rule is a fact about the count.
 */

const CAPTAIN = { userId: 'u-captain', role: 'captain', status: 'active' } as const
const MEMBER = { userId: 'u-member', role: 'member', status: 'active' } as const

const decide = (over: Partial<MemberChangeInput> = {}) =>
  decideMemberChange({
    actorId: 'u-someone-else',
    target: MEMBER,
    body: { status: 'disabled' },
    activeCaptainCount: 2,
    ...over,
  })

describe('you cannot disable your own account', () => {
  test('disabling yourself is refused, with a message about the actor', () => {
    const decision = decide({
      actorId: 'u-captain',
      target: CAPTAIN,
      body: { status: 'disabled' },
    })

    expect(decision).toEqual({
      ok: false,
      status: 409,
      reason: 'self_disable',
      message: 'You cannot disable your own account',
    })
  })

  test('stepping down from captain is not the same as disabling yourself', () => {
    const decision = decide({ actorId: 'u-captain', target: CAPTAIN, body: { role: 'member' } })

    expect(decision.ok).toBe(true)
  })

  test('the self-check outranks the captain-count check, because it is the clearer message', () => {
    const decision = decide({
      actorId: 'u-captain',
      target: CAPTAIN,
      body: { status: 'disabled' },
      activeCaptainCount: 1,
    })

    expect(decision.ok === false && decision.reason).toBe('self_disable')
  })
})

describe('a team keeps at least one active captain', () => {
  test('demoting the last active captain is refused', () => {
    const decision = decide({
      target: CAPTAIN,
      body: { role: 'member' },
      activeCaptainCount: 1,
    })

    expect(decision).toEqual({
      ok: false,
      status: 409,
      reason: 'last_captain',
      message: 'There has to be at least one active captain',
    })
  })

  test('disabling the last active captain is refused', () => {
    const decision = decide({
      target: CAPTAIN,
      body: { status: 'disabled' },
      activeCaptainCount: 1,
    })

    expect(decision.ok).toBe(false)
  })

  test('demoting a captain is fine while a second active captain exists', () => {
    const decision = decide({
      target: CAPTAIN,
      body: { role: 'member' },
      activeCaptainCount: 2,
    })

    expect(decision.ok).toBe(true)
  })

  test('demoting a captain who is already disabled is fine, because they are not the active one', () => {
    // the count only covers *active* captains, so a disabled target is never in it: taking their
    // captaincy away cannot reduce the team's active captains at all
    const decision = decide({
      target: { ...CAPTAIN, status: 'disabled' },
      body: { role: 'member' },
      activeCaptainCount: 1,
    })

    expect(decision).toEqual({ ok: true, changes: { role: 'member' } })
  })

  test('changing a regular member never asks about captains', () => {
    const decision = decide({
      target: MEMBER,
      body: { status: 'disabled' },
      activeCaptainCount: 1,
    })

    expect(decision.ok).toBe(true)
  })

  test('a body that changes nothing is accepted without touching any rule', () => {
    const decision = decide({ target: CAPTAIN, body: {}, activeCaptainCount: 1 })

    expect(decision).toEqual({ ok: true, changes: {} })
  })

  test('promoting a member is never blocked by the captain count', () => {
    const decision = decide({ target: MEMBER, body: { role: 'captain' }, activeCaptainCount: 1 })

    expect(decision.ok).toBe(true)
  })
})

describe('the accepted change', () => {
  test('carries only the fields the body actually named', () => {
    // absent is not "unchanged": the PATCH handler puts these straight into an UPDATE, so a field
    // that was not sent must not appear — otherwise a role toggle would also rewrite the status.
    const onlyRole = decide({ body: { role: 'member' } })
    const onlyStatus = decide({ body: { status: 'disabled' } })

    expect(onlyRole).toEqual({ ok: true, changes: { role: 'member' } })
    expect(onlyStatus).toEqual({ ok: true, changes: { status: 'disabled' } })
  })

  test('carries both when both were named', () => {
    expect(decide({ body: { role: 'member', status: 'disabled' } })).toEqual({
      ok: true,
      changes: { role: 'member', status: 'disabled' },
    })
  })
})
