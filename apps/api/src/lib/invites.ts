import { eq, sql } from 'drizzle-orm'
import type { Db } from '../db/index.ts'
import { invites, memberships } from '../db/schema.ts'

export type ClaimOutcome =
  | { ok: true; inviteId: string }
  | { ok: false; status: 404 | 410; message: string }

/**
 * Validates an invite code and, if usable, activates the user's membership in the
 * invite's team and burns one use, in one transaction.
 * Pure business rule (no Elysia, no HTTP) so it can be tested directly.
 */
export async function claimInvite(
  db: Db,
  input: { userId: string; code: string },
): Promise<ClaimOutcome> {
  const [invite] = await db.select().from(invites).where(eq(invites.code, input.code)).limit(1)
  if (!invite) return { ok: false, status: 404, message: 'Invite not found' }
  if (invite.revokedAt) return { ok: false, status: 410, message: 'This invite was revoked' }
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
    return { ok: false, status: 410, message: 'This invite expired' }
  }
  if (invite.uses >= invite.maxUses) {
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

  return { ok: true, inviteId: invite.id }
}
