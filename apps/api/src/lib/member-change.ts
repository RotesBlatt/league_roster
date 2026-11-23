import type { MemberStatus, UserRole } from '@lol/shared'

/**
 * What a captain may change about one member, and what the team may not lose in the process.
 *
 * Pure on purpose: the two rules here are about *relationships* (you and yourself, the target and
 * the rest of the team), not about HTTP. The route supplies the facts — who is acting, what the
 * target is today, how many active captains the team has — and gets a decision back. The DB reads
 * stay in the route, because a rule that queries cannot be tested without a database.
 */

/** The only fields a captain owns. A partial body means "leave the rest alone". */
export type MemberChangeBody = { role?: UserRole; status?: MemberStatus }

export type MemberChangeTarget = { userId: string; role: UserRole; status: MemberStatus }

export type MemberChangeInput = {
  /** the captain making the request */
  actorId: string
  target: MemberChangeTarget
  body: MemberChangeBody
  /** active captains in the target's team, *including* the target */
  activeCaptainCount: number
}

export type MemberChangeRejection = 'self_disable' | 'last_captain'

export type MemberChangeDecision =
  | { ok: true; changes: MemberChangeBody }
  | { ok: false; status: 409; reason: MemberChangeRejection; message: string }

/** An omitted field never reaches the UPDATE: `undefined` would be "unset", not "unchanged". */
function changesOf(body: MemberChangeBody): MemberChangeBody {
  return {
    ...(body.role !== undefined && { role: body.role }),
    ...(body.status !== undefined && { status: body.status }),
  }
}

/**
 * Order matters, and the order is the useful one: "you cannot disable yourself" is answered before
 * "the team would have no captain", because locking yourself out is the mistake a captain is more
 * likely to make and the message is the more actionable of the two.
 */
export function decideMemberChange(input: MemberChangeInput): MemberChangeDecision {
  const { actorId, target, body, activeCaptainCount } = input

  if (target.userId === actorId && body.status === 'disabled') {
    return {
      ok: false,
      status: 409,
      reason: 'self_disable',
      message: 'You cannot disable your own account',
    }
  }

  const changes = changesOf(body)
  // nothing to change: no rule can be violated by a no-op, so a last captain may "change" nothing
  if (Object.keys(changes).length === 0) return { ok: true, changes }

  // the target is a captain and the change takes that captaincy away — either by demoting the
  // role or by disabling the account
  const spendsACaptain =
    target.role === 'captain' && (changes.role === 'member' || changes.status === 'disabled')

  if (spendsACaptain && activeCaptainCount <= 1) {
    return {
      ok: false,
      status: 409,
      reason: 'last_captain',
      message: 'There has to be at least one active captain',
    }
  }

  return { ok: true, changes }
}
