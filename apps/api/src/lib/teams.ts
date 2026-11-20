import { SHORT_NAME_MAX } from '@lol/shared'
import { and, asc, eq } from 'drizzle-orm'
import type { Db } from '../db/index.ts'
import { memberships, teams } from '../db/schema.ts'
import type { TeamSummary } from '../db/schema.types.ts'
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

/**
 * The teams one account may act as, for the switcher. Only `active` memberships: a disabled
 * one is not a usable team, and it is not this list's job to advertise a team you cannot open.
 * Ordered by slug so the switcher's order is stable.
 */
export async function listTeamsForUser(db: Db, userId: string): Promise<TeamSummary[]> {
  return db
    .select({
      id: teams.id,
      slug: teams.slug,
      name: teams.name,
      shortName: teams.shortName,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(teams, eq(teams.id, memberships.teamId))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active')))
    .orderBy(asc(teams.slug))
}

export type CreateTeamResult =
  | { ok: true; team: TeamRow; membership: MembershipRow }
  | { ok: false; status: 409 | 422; message: string }

/** A unique violation on `team.slug`: someone else already owns the slug this update names. */
function isSlugConflict(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } } | null)?.code
  return (code ?? (error as { cause?: { code?: string } } | null)?.cause?.code) === '23505'
}

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

export type RenameTeamResult =
  | { ok: true; team: TeamRow }
  | { ok: false; status: 409 | 422; message: string }

/**
 * Renaming is the captain's edit of the same two fields `createTeam` took, plus the slug they
 * imply (multi-team.md §11.2 / team-rename.md §2): the URL follows the name, so a rename that
 * changes the name usually changes the slug. `shortName: undefined` leaves it as it is; an empty
 * one clears it.
 *
 * A slug another team owns is a 409 (the name is fine, it is taken) and the row stays as it was.
 * There is no `onConflictDoNothing` for an UPDATE, so the unique index is the test: one statement,
 * and a losing race arrives as the same 409 as a plain collision. Renaming to the team's own slug
 * never conflicts — a row does not collide with itself.
 */
export async function renameTeam(
  db: Db,
  input: { team: TeamRow; name: string; shortName?: string | null },
): Promise<RenameTeamResult> {
  const name = input.name.trim()
  const slug = slugify(name)

  const problem = slugProblem(slug)
  if (problem) return { ok: false, status: 422, message: problem }

  const shortName =
    input.shortName === undefined ? input.team.shortName : blankToNull(input.shortName)
  if (shortName && shortName.length > SHORT_NAME_MAX) {
    return {
      ok: false,
      status: 422,
      message: `The short name must be at most ${SHORT_NAME_MAX} characters`,
    }
  }

  try {
    const [team] = await db
      .update(teams)
      .set({ name, shortName, slug })
      .where(eq(teams.id, input.team.id))
      .returning()

    // unreachable while the guard's team row exists; failing loudly beats a silent no-op
    if (!team) throw new Error(`team ${input.team.id} vanished during rename`)

    return { ok: true, team }
  } catch (error) {
    if (isSlugConflict(error)) {
      return { ok: false, status: 409, message: 'That team name is already taken' }
    }
    throw error
  }
}
