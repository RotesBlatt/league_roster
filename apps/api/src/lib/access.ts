import { and, asc, count, eq } from 'drizzle-orm'
import type { Db } from '../db/index.ts'
import { account, memberships, teams, user } from '../db/schema.ts'
import type { Me } from '../db/schema.types.ts'
import { env } from '../env.ts'
import type { MembershipRow, TeamRow } from './teams.ts'

/** Placeholder tenant until `POST /api/teams` exists: the first account creates it. */
const DEFAULT_TEAM_SLUG = 'default'
const DEFAULT_TEAM_NAME = 'My Team'

function toMe(row: {
  id: string
  name: string
  email: string
  image: string | null
  teamId: string | null
  teamSlug: string | null
  role: Me['role'] | null
  status: Me['status'] | null
}): Me {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    image: row.image,
    teamId: row.teamId,
    teamSlug: row.teamSlug,
    role: row.role ?? 'member',
    status: row.status ?? 'pending',
  }
}

/** The `Me` for one specific team — what a team-scoped route handler sees. */
export function meForTeam(
  identity: { id: string; name: string; email: string; image: string | null },
  team: TeamRow,
  membership: MembershipRow,
): Me {
  return {
    id: identity.id,
    name: identity.name,
    email: identity.email,
    image: identity.image,
    teamId: team.id,
    teamSlug: team.slug,
    role: membership.role,
    status: membership.status,
  }
}

/**
 * Identity comes from `user`, role/status from `membership`.
 * No membership row means "pending member, no team" — the same thing the old
 * `user.status = 'pending'` default said.
 *
 * A user in several teams currently resolves to the oldest membership (first one joined).
 * Team-scoped routes do not use this: they get the team from the path.
 */
export async function getMe(db: Db, userId: string): Promise<Me | null> {
  const [row] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      teamId: memberships.teamId,
      teamSlug: teams.slug,
      role: memberships.role,
      status: memberships.status,
    })
    .from(user)
    .leftJoin(memberships, eq(memberships.userId, user.id))
    .leftJoin(teams, eq(teams.id, memberships.teamId))
    .where(eq(user.id, userId))
    .orderBy(asc(memberships.joinedAt), asc(memberships.id))
    .limit(1)

  return row ? toMe(row) : null
}

/** The default team, created on first use. Unique slug makes the race harmless. */
async function ensureDefaultTeam(db: Db, createdBy: string): Promise<string> {
  const [existing] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.slug, DEFAULT_TEAM_SLUG))
    .limit(1)
  if (existing) return existing.id

  await db
    .insert(teams)
    .values({
      id: crypto.randomUUID(),
      slug: DEFAULT_TEAM_SLUG,
      name: DEFAULT_TEAM_NAME,
      createdAt: new Date(),
      createdBy,
    })
    .onConflictDoNothing({ target: teams.slug })

  const [row] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.slug, DEFAULT_TEAM_SLUG))
    .limit(1)
  if (!row) throw new Error('could not create the default team')
  return row.id
}

async function countActiveMemberships(db: Db): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(memberships)
    .where(eq(memberships.status, 'active'))
  return row?.value ?? 0
}

async function grantCaptain(db: Db, userId: string, teamId: string): Promise<void> {
  const now = new Date()
  await db
    .insert(memberships)
    .values({
      id: crypto.randomUUID(),
      teamId,
      userId,
      role: 'captain',
      status: 'active',
      joinedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [memberships.teamId, memberships.userId],
      set: { role: 'captain', status: 'active', updatedAt: now },
    })
}

/**
 * Allowlist + bootstrap policy, cheap enough to run on every authenticated request:
 *  - a Discord id in the captain allowlist is always captain + active (in a team)
 *  - if nobody is active anywhere, the first account to show up becomes captain (fresh install)
 *  - disabled accounts stay disabled, even when allowlisted
 * Everyone else lands in `pending` until a captain approves them or they claim an invite.
 *
 * Creating a team is what makes you its captain (`multi-team.md` §4); until there is a
 * "create team" route, the bootstrap path creates the default team to do it. Team-scoped
 * routes never call this — they read the membership for the team in the path.
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
  const bootstrap = me.status !== 'active' && (await countActiveMemberships(db)) === 0

  if (!allowlisted && !bootstrap) return me

  const teamId = me.teamId ?? (await ensureDefaultTeam(db, userId))
  await grantCaptain(db, userId, teamId)

  return { ...me, teamId, teamSlug: me.teamSlug ?? DEFAULT_TEAM_SLUG, role: 'captain', status: 'active' }
}
