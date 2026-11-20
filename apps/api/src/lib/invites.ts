import { eq, sql } from 'drizzle-orm'
import type { Db } from '../db/index.ts'
import { invites, memberships } from '../db/schema.ts'
import type { Fields, Logger } from './log/logger.ts'
import { noopLogger } from './log/noop.ts'

export type ClaimOutcome =
  | { ok: true; inviteId: string }
  | { ok: false; status: 404 | 410; message: string }

type Rejection = 'not_found' | 'revoked' | 'expired' | 'used_up'

/** Logged by id only — an invite code is a bearer token and must never reach a line. */
function reject(log: Logger, userId: string, reason: Rejection, inviteId?: string): void {
  const fields: Fields = { userId, reason }
  if (inviteId !== undefined) fields.inviteId = inviteId
  log.warn('invite.claim_rejected', fields)
}

/**
 * Validates an invite code and, if usable, activates the user's membership in the
 * invite's team and burns one use, in one transaction.
 * Pure business rule (no Elysia, no HTTP) so it can be tested directly.
 */
export async function claimInvite(
  db: Db,
  input: { userId: string; code: string; log?: Logger },
): Promise<ClaimOutcome> {
  const log = input.log ?? noopLogger
  const [invite] = await db.select().from(invites).where(eq(invites.code, input.code)).limit(1)
  if (!invite) {
    reject(log, input.userId, 'not_found')
    return { ok: false, status: 404, message: 'Invite not found' }
  }
  if (invite.revokedAt) {
    reject(log, input.userId, 'revoked', invite.id)
    return { ok: false, status: 410, message: 'This invite was revoked' }
  }
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
    reject(log, input.userId, 'expired', invite.id)
    return { ok: false, status: 410, message: 'This invite expired' }
  }
  if (invite.uses >= invite.maxUses) {
    reject(log, input.userId, 'used_up', invite.id)
    return { ok: false, status: 410, message: 'This invite is used up' }
  }

  const now = new Date()
  await db.transaction(async (tx) => {
    await tx
      .update(invites)
      .set({ uses: sql`${invites.uses} + 1` })
      .where(eq(invites.id, invite.id))

    // The code belongs to one team, so claiming joins *that* team — not "the" team.
    await tx
      .insert(memberships)
      .values({
        id: crypto.randomUUID(),
        teamId: invite.teamId,
        userId: input.userId,
        role: 'member',
        status: 'active',
        joinedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [memberships.teamId, memberships.userId],
        set: { status: 'active', updatedAt: now },
      })
  })

  log.info('invite.claimed', {
    inviteId: invite.id,
    userId: input.userId,
    uses: invite.uses + 1,
    maxUses: invite.maxUses,
  })
  return { ok: true, inviteId: invite.id }
}
