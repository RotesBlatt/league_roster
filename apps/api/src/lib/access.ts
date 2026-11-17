import { and, count, eq } from 'drizzle-orm'
import type { Db } from '../db/index.ts'
import { account, user } from '../db/schema.ts'
import type { Me } from '../db/schema.types.ts'
import { env } from '../env.ts'

function toMe(row: {
  id: string
  name: string
  email: string
  image: string | null
  role: Me['role']
  status: Me['status']
}): Me {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    image: row.image,
    role: row.role,
    status: row.status,
  }
}

export async function getMe(db: Db, userId: string): Promise<Me | null> {
  const [row] = await db.select().from(user).where(eq(user.id, userId)).limit(1)
  return row ? toMe(row) : null
}

/**
 * Bootstrap + allowlist policy, cheap enough to run on every authenticated request:
 *  - a Discord id in the captain allowlist is always captain + active
 *  - if nobody is active yet, the first account to show up becomes captain (fresh install)
 *  - disabled accounts stay disabled, even when allowlisted
 * Everyone else lands in `pending` until a captain approves them or they claim an invite.
 */
export async function ensureAccess(
  db: Db,
  userId: string,
  allowlist: readonly string[] = env.captainDiscordIds,
): Promise<Me> {
  const me = await getMe(db, userId)
  if (!me) throw new Error(`user ${userId} not found`)
  if (me.status === 'disabled') return me

  const [discord] = await db
    .select({ accountId: account.accountId })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'discord')))
    .limit(1)

  const allowlisted = discord ? allowlist.includes(discord.accountId) : false
  let promote = allowlisted

  if (!promote && me.status !== 'active') {
    const [row] = await db.select({ value: count() }).from(user).where(eq(user.status, 'active'))
    promote = (row?.value ?? 0) === 0
  }

  if (!promote) return me

  const next: Me = { ...me, role: 'captain', status: 'active' }
  await db
    .update(user)
    .set({ role: next.role, status: next.status, updatedAt: new Date() })
    .where(eq(user.id, userId))
  return next
}
