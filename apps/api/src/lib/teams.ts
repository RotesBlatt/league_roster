import { SHORT_NAME_MAX } from '@lol/shared'
import { and, eq } from 'drizzle-orm'
import type { Db } from '../db/index.ts'
import { memberships, teams } from '../db/schema.ts'
import { slugify, slugProblem } from './slug.ts'

export type TeamRow = typeof teams.$inferSelect
export type MembershipRow = typeof memberships.$inferSelect

/** The tenant is addressed by slug in the URL (`/api/teams/:slug/...`), never by id. */
export async function getTeamBySlug(db: Db, slug: string): Promise<TeamRow | null> {
  const [row] = await db.select().from(teams).where(eq(teams.slug, slug)).limit(1)
  return row ?? null
}

export async function getMembership(
  db: Db,
  input: { teamId: string; userId: string },
): Promise<MembershipRow | null> {
  const [row] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.teamId, input.teamId), eq(memberships.userId, input.userId)))
    .limit(1)
  return row ?? null
}

export type CreateTeamResult =
  | { ok: true; team: TeamRow; membership: MembershipRow }
  | { ok: false; status: 409 | 422; message: string }

const blankToNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/**
 * Creating a team *is* what makes you its captain (multi-team.md §4): the team row and
 * the creator's `captain`/`active` membership land in one transaction, so there is no
 * moment where a team exists without one.
 *
 * The slug is derived from the name, never typed (§7.2). An unusable or reserved name is a
 * 422; a name whose slug is already taken is a 409, because the name is fine — it is taken.
 */
export async function createTeam(
  db: Db,
  input: { userId: string; name: string; shortName?: string | null },
): Promise<CreateTeamResult> {
  const name = input.name.trim()
  const slug = slugify(name)

  const problem = slugProblem(slug)
  if (problem) return { ok: false, status: 422, message: problem }

  const shortName = blankToNull(input.shortName)
  if (shortName && shortName.length > SHORT_NAME_MAX) {
    return {
      ok: false,
      status: 422,
      message: `The short name must be at most ${SHORT_NAME_MAX} characters`,
    }
  }

  return db.transaction(async (tx) => {
    const now = new Date()
    // onConflictDoNothing instead of catching a unique violation: the loser of a race gets
    // the same 409 as the loser of a check-then-insert, and no half-created team survives.
    const [team] = await tx
      .insert(teams)
      .values({
        id: crypto.randomUUID(),
        name,
        shortName,
        slug,
        createdAt: now,
        createdBy: input.userId,
      })
      .onConflictDoNothing({ target: teams.slug })
      .returning()

    if (!team) {
      return { ok: false, status: 409, message: 'That team name is already taken' } as const
    }

    const [membership] = await tx
      .insert(memberships)
      .values({
        id: crypto.randomUUID(),
        teamId: team.id,
        userId: input.userId,
        role: 'captain',
        status: 'active',
        joinedAt: now,
        updatedAt: now,
      })
      .returning()

    // the FK makes this unreachable; failing loudly beats returning a team nobody owns
    if (!membership) throw new Error(`could not make ${input.userId} captain of ${team.id}`)

    return { ok: true, team, membership } as const
  })
}
