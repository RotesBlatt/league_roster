import { and, eq } from 'drizzle-orm'
import type { Db } from '../db/index.ts'
import { memberships, teams } from '../db/schema.ts'

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
