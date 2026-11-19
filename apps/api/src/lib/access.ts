import { asc, eq } from 'drizzle-orm'
import type { Db } from '../db/index.ts'
import { memberships, teams, user } from '../db/schema.ts'
import type { Me } from '../db/schema.types.ts'
import type { MembershipRow, TeamRow } from './teams.ts'

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
    status: row.status ?? null,
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
 * No membership row means "not a member of any team": `status` is null, as opposed to
 * `disabled`, which is a decision a captain made about an existing membership.
 *
 * Read-only, on purpose. A team is entered by claiming an invite or created with
 * `POST /api/teams` — never by being signed in. The bootstrap that invented a `default`
 * team for the first account, and the `CAPTAIN_DISCORD_IDS` allowlist that rode on it, are
 * gone (multi-team.md §9, §10.4).
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
