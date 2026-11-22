import { computeCoverage, findPlayWindows } from '@lol/shared'
import { and, eq, inArray } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import type { Db } from '../db/index.ts'
import {
  type AvailabilityRow,
  answers,
  availability,
  availabilityTemplates,
  memberships,
  type WeekRow,
  weeks,
} from '../db/schema.ts'
import type { PlannerDto, PlannerTemplateDto, PlannerWeekDto } from '../db/schema.types.ts'
import type { TeamScope } from '../lib/team-db.ts'
import type { TeamRow } from '../lib/teams.ts'
import { canEditAvailability } from '../planner/access.ts'
import {
  addDays,
  resolveWindowStart,
  splitAnswers,
  startOfWeek,
  todayInZone,
} from '../planner/week.ts'
import {
  DAYS_PER_WEEK,
  daysFromRows,
  isWeekWritable,
  normalizeWeekWrite,
  VISIBLE_WEEKS,
} from '../planner/write.ts'
import type { AuthPlugin } from '../plugins/auth.ts'

/**
 * The week planner (availability-planner.md §4–§9).
 *
 * Two things are deliberately absent from this file:
 *   - the arithmetic: coverage and play windows are `@lol/shared` pure functions, normalisation is
 *     `planner/write.ts`. A handler here only reads, checks a rule and writes what it was given;
 *   - the window: it is computed from the team's clock on every request (`planner/week.ts`), so
 *     there is no stored "current week" to fall out of date — not after a deploy, not after a
 *     fortnight of downtime.
 *
 * Weeks are provisioned on **write**, not on read: a GET stays a GET (§4b's "no write on read").
 */

/** The painted grid, as the browser sends it: seven optional days of half-hour intervals. */
const daysBody = t.Array(
  t.Object({
    dayOfWeek: t.Integer(),
    intervals: t.Array(t.Object({ start: t.Integer(), end: t.Integer() }), { maxItems: 48 }),
  }),
  { maxItems: DAYS_PER_WEEK },
)

const weekBody = t.Object({
  /**
   * Whose week. Optional and almost always absent: the rule is "your own", and naming somebody
   * else is a 403 rather than a silently redirected write (§8).
   */
  userId: t.Optional(t.String()),
  days: daysBody,
})

/** A standing schedule names nobody: it is always the caller's own (§4b). */
const templateBody = t.Object({ days: daysBody })

const weekParams = t.Object({
  slug: t.String(),
  startsOn: t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
})

const CLOSED = { message: 'That week is closed' }
const NOT_MONDAY = { message: 'A week starts on a Monday' }
const NOT_YOURS = { message: 'Availability is personal — you can only write your own' }

/**
 * A week's answers and availability, rendered into what the page shows.
 *
 * `days` is computed here from *all* answers, so a member sees the merged summary of the team, not
 * just their own rows. Windows are always seven entries: a day with nothing is an empty list.
 */
async function composeWeeks(
  db: Db,
  scope: ReturnType<TeamScope>,
  weekStarts: readonly string[],
  roster: readonly string[],
): Promise<PlannerWeekDto[]> {
  const weekRows = await scope.selectFrom(weeks, inArray(weeks.startsOn, [...weekStarts]))
  const idByStart = new Map<string, WeekRow>(weekRows.map((row) => [row.startsOn, row]))
  const weekIds = weekRows.map((row) => row.id)

  // `answer` and `availability` have no teamId of their own: they hang off a week, and the ids
  // below came from rows the scope already proved belong to this team
  const [answerRows, availabilityRows]: [(typeof answers.$inferSelect)[], AvailabilityRow[]] =
    weekIds.length === 0
      ? [[], []]
      : await Promise.all([
          db.select().from(answers).where(inArray(answers.weekId, weekIds)),
          db.select().from(availability).where(inArray(availability.weekId, weekIds)),
        ])

  return weekStarts.map((startsOn) => {
    const week = idByStart.get(startsOn)
    const weekId = week?.id
    const answeredIds = answerRows.filter((row) => row.weekId === weekId).map((row) => row.userId)
    const rows = availabilityRows.filter((row) => row.weekId === weekId)

    const days = Array.from({ length: DAYS_PER_WEEK }, (_, dayOfWeek) => {
      const people = rows
        .filter((row) => row.dayOfWeek === dayOfWeek)
        .map((row) => ({ userId: row.userId, start: row.startMinute, end: row.endMinute }))

      return {
        dayOfWeek,
        windows: findPlayWindows(computeCoverage(people), { roster: [...roster] }),
      }
    })

    return {
      startsOn,
      unlocked: week?.unlockedAt != null,
      ...splitAnswers(roster, answeredIds),
      availability: rows.map((row) => ({
        userId: row.userId,
        dayOfWeek: row.dayOfWeek,
        startMinute: row.startMinute,
        endMinute: row.endMinute,
      })),
      days,
    }
  })
}

/** Active members in join order — the roster the summary and the chase list are measured against. */
async function activeRoster(scope: ReturnType<TeamScope>): Promise<string[]> {
  const members = await scope.selectFrom(memberships, eq(memberships.status, 'active'), {
    orderBy: [memberships.joinedAt],
  })
  return members.map((member) => member.userId)
}

export function createPlannerRoutes(db: Db, scope: TeamScope, authPlugin: AuthPlugin) {
  const windowOf = (team: TeamRow, now: Date) =>
    resolveWindowStart(now, { floor: team.plannerStart, timezone: team.timezone })

  return (
    new Elysia({ prefix: '/planner' })
      .use(authPlugin)
      /** Both visible weeks, everyone's entries and the windows they enable. `member` may read. */
      .get(
        '/',
        async ({ team }): Promise<PlannerDto> => {
          const now = new Date()
          const windowStart = windowOf(team, now)
          const weekStarts = Array.from({ length: VISIBLE_WEEKS }, (_, index) =>
            addDays(windowStart, index * 7),
          )
          const roster = await activeRoster(scope(team))

          return {
            timezone: team.timezone,
            today: todayInZone(now, team.timezone),
            windowStart,
            roster,
            weeks: await composeWeeks(db, scope(team), weekStarts, roster),
          }
        },
        { teamMember: true },
      )
      /**
       * My standing times (§4b). Read and written independently of any week: this is a template, and
       * the week it prefills stays the member's statement about that week.
       *
       * Registered before `/:startsOn` so the literal path is never read as a date.
       */
      .get(
        '/template',
        async ({ team, me }): Promise<PlannerTemplateDto> => {
          const rows = await scope(team).selectFrom(
            availabilityTemplates,
            eq(availabilityTemplates.userId, me.id),
          )

          return { days: daysFromRows(rows) }
        },
        { teamMember: true },
      )
      .put(
        '/template',
        async ({ body, team, me, status }) => {
          const { rows, problems } = normalizeWeekWrite(body.days)
          if (problems.length > 0) {
            return status(422, {
              message: 'Invalid availability',
              details: problems.map((problem) => ({
                path: problem.field,
                message: problem.message,
              })),
            })
          }

          const now = new Date()
          await db.transaction(async (tx) => {
            // wholesale replace, like a week save: the grid is what this person said their week
            // looks like, and a delete + insert cannot leave half of the old schedule behind
            await tx
              .delete(availabilityTemplates)
              .where(
                and(
                  eq(availabilityTemplates.teamId, team.id),
                  eq(availabilityTemplates.userId, me.id),
                ),
              )

            if (rows.length > 0) {
              await tx.insert(availabilityTemplates).values(
                rows.map((row) => ({
                  id: crypto.randomUUID(),
                  teamId: team.id,
                  userId: me.id,
                  ...row,
                  createdAt: now,
                  updatedAt: now,
                })),
              )
            }
          })

          return { ok: true, intervals: rows.length }
        },
        { teamMember: true, body: templateBody },
      )
      /**
       * Save one week for one person: replace their rows wholesale, then stamp the answer.
       *
       * Wholesale replace, not a diff: the grid is the truth of what this person said, and a delete
       * plus insert inside one transaction cannot leave a half-old/half-new week behind. The
       * `answer` row is upserted last and is what makes "answered nothing" distinguishable from
       * "hasn't answered" (§4).
       */
      .put(
        '/:startsOn',
        async ({ body, params: { startsOn }, team, me, status }) => {
          if (startOfWeek(startsOn) !== startsOn) return status(422, NOT_MONDAY)

          const targetUserId = body.userId ?? me.id
          if (!canEditAvailability(me, targetUserId)) return status(403, NOT_YOURS)

          const { rows, problems } = normalizeWeekWrite(body.days)
          if (problems.length > 0) {
            return status(422, {
              message: 'Invalid availability',
              details: problems.map((problem) => ({
                path: problem.field,
                message: problem.message,
              })),
            })
          }

          const now = new Date()
          const [existing] = await scope(team).selectFrom(weeks, eq(weeks.startsOn, startsOn))
          const writable = isWeekWritable(
            { startsOn, unlockedAt: existing?.unlockedAt ?? null },
            windowOf(team, now),
          )
          if (!writable) return status(409, CLOSED)

          await db.transaction(async (tx) => {
            // Lazy provisioning, made idempotent by UNIQUE(teamId, startsOn): two tabs saving at
            // once must not create two weeks, and nobody has to run a cron to have a row to save to.
            await tx
              .insert(weeks)
              .values({
                id: crypto.randomUUID(),
                teamId: team.id,
                startsOn,
                createdBy: me.id,
                createdAt: now,
              })
              .onConflictDoNothing()

            const [week] = await tx
              .select()
              .from(weeks)
              .where(and(eq(weeks.teamId, team.id), eq(weeks.startsOn, startsOn)))
              .limit(1)
            if (!week) throw new Error(`week ${startsOn} vanished after provisioning`)

            await tx
              .delete(availability)
              .where(and(eq(availability.weekId, week.id), eq(availability.userId, targetUserId)))

            if (rows.length > 0) {
              await tx.insert(availability).values(
                rows.map((row) => ({
                  id: crypto.randomUUID(),
                  weekId: week.id,
                  userId: targetUserId,
                  ...row,
                  createdAt: now,
                  updatedAt: now,
                })),
              )
            }

            await tx
              .insert(answers)
              .values({
                id: crypto.randomUUID(),
                weekId: week.id,
                userId: targetUserId,
                submittedAt: now,
              })
              .onConflictDoUpdate({
                target: [answers.weekId, answers.userId],
                set: { submittedAt: now },
              })
          })

          return { ok: true, startsOn, answeredAt: now.getTime(), intervals: rows.length }
        },
        { teamMember: true, params: weekParams, body: weekBody },
      )
  )
}

export type PlannerRoutes = ReturnType<typeof createPlannerRoutes>
