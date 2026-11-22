import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { answers, availability, availabilityTemplates, weeks } from '../../src/db/schema.ts'
import type { PlannerDto } from '../../src/db/schema.types.ts'
import { addDays, resolveWindowStart } from '../../src/planner/week.ts'
import {
  addMembership,
  createSessionCookie,
  createTestApp,
  createTestContext,
  createUser,
  seedTeam,
  type TestContext,
  type TestServer,
} from './helpers.ts'

/**
 * `GET /api/teams/:slug/planner` and `PUT .../planner/:startsOn`.
 *
 * The window is derived from the clock, so the test asks the same pure function for the dates
 * instead of hardcoding a Monday that would expire: what is asserted is the *behaviour* (two weeks,
 * offset by seven days, this week writable), not today's date.
 */
let ctx: TestContext
let server: TestServer
let call: TestServer['call']

let teamId: string
let captainId: string
let members: string[]
let outsiderCookie: string
let memberCookie: string

const thisWeek = () => resolveWindowStart(new Date(), { floor: null, timezone: 'Europe/Berlin' })
const nextWeek = () => addDays(thisWeek(), 7)

/**
 * Drizzle throws a wrapped error whose message is only the SQL; the constraint name lives on
 * `cause`. Asserting on both keeps the test reading the driver's answer, not drizzle's summary.
 */
async function rejectsWith(query: PromiseLike<unknown>, pattern: RegExp) {
  let error: unknown = null
  try {
    await query
  } catch (cause) {
    error = cause
  }

  expect(error).not.toBeNull()

  const text = [error, (error as { cause?: unknown } | null)?.cause].map(String).join(' | ')
  expect(text).toMatch(pattern)
}

const save = (cookie: string, startsOn: string, days: unknown) =>
  call(`/api/teams/alpha/planner/${startsOn}`, { method: 'PUT', cookie, body: { days } })

const planner = async (cookie: string) => {
  const response = await call('/api/teams/alpha/planner', { cookie })
  expect(response.status).toBe(200)
  return (await response.json()) as PlannerDto
}

/** Tuesday 20:00–23:00, the window the summary tests revolve around. */
const tuesdayEvening = [{ dayOfWeek: 1, intervals: [{ start: 1200, end: 1380 }] }]

beforeAll(async () => {
  ctx = await createTestContext()
  server = createTestApp(ctx)
  call = server.call

  captainId = await createUser(ctx, { name: 'Captain' })
  // a full roster: four players plus the captain, so MIN_PLAYABLE (4) can be reached and missed
  members = [
    await createUser(ctx, { name: 'Mid' }),
    await createUser(ctx, { name: 'ADC' }),
    await createUser(ctx, { name: 'Jungle' }),
    await createUser(ctx, { name: 'Support' }),
  ]
  const outsiderId = await createUser(ctx, { name: 'Outsider' })
  const disabledId = await createUser(ctx, { name: 'Gone' })

  teamId = await seedTeam(ctx, { createdBy: captainId, slug: 'alpha', name: 'Alpha' })
  await addMembership(ctx, { teamId, userId: captainId, role: 'captain' })
  for (const userId of members) await addMembership(ctx, { teamId, userId })
  await addMembership(ctx, { teamId, userId: disabledId, status: 'disabled' })

  memberCookie = await createSessionCookie(ctx, members[0]!)
  outsiderCookie = await createSessionCookie(ctx, outsiderId)
})

afterAll(async () => {
  server.close()
  await ctx.drop()
})

const everyone = () => [captainId, ...members]

describe('guards', () => {
  test('reading and writing both need a session', async () => {
    expect((await call('/api/teams/alpha/planner')).status).toBe(401)
    expect(
      (await call(`/api/teams/alpha/planner/${thisWeek()}`, { method: 'PUT', body: { days: [] } }))
        .status,
    ).toBe(401)
  })

  test('a non-member sees the same 404 as a team that does not exist', async () => {
    expect((await call('/api/teams/alpha/planner', { cookie: outsiderCookie })).status).toBe(404)
    expect((await save(outsiderCookie, thisWeek(), [])).status).toBe(404)
  })
})

describe('GET /planner', () => {
  test('shows this week and next week, in the team’s zone', async () => {
    const dto = await planner(memberCookie)

    expect(dto.timezone).toBe('Europe/Berlin')
    expect(dto.windowStart).toBe(thisWeek())
    expect(dto.weeks.map((week) => week.startsOn)).toEqual([thisWeek(), nextWeek()])
  })

  test('the roster is the active members, and everyone still counts as unanswered', async () => {
    const dto = await planner(memberCookie)

    expect(dto.roster.sort()).toEqual(everyone().sort())
    expect(dto.weeks[0]?.answered).toEqual([])
    expect(dto.weeks[0]?.unanswered.sort()).toEqual(everyone().sort())
  })

  test('a week without answers has seven days and no windows — not a blank page', async () => {
    const week = (await planner(memberCookie)).weeks[0]

    expect(week?.days.map((day) => day.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(week?.days.every((day) => day.windows.length === 0)).toBe(true)
    expect(week?.availability).toEqual([])
  })
})

describe('PUT /planner/:startsOn — my week', () => {
  test('saves the grid and stamps the answer', async () => {
    const response = await save(memberCookie, thisWeek(), tuesdayEvening)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, intervals: 1 })

    const week = (await planner(memberCookie)).weeks[0]
    expect(week?.answered).toEqual([members[0]!])
    expect(week?.availability).toEqual([
      { userId: members[0]!, dayOfWeek: 1, startMinute: 1200, endMinute: 1380 },
    ])
  })

  test('adjacent painted cells arrive as one stored interval', async () => {
    await save(memberCookie, thisWeek(), [
      {
        dayOfWeek: 2,
        intervals: [
          { start: 540, end: 720 },
          { start: 720, end: 900 },
        ],
      },
    ])

    const rows = await ctx.db
      .select()
      .from(availability)
      .where(eq(availability.userId, members[0]!))
    const wednesday = rows.filter((row) => row.dayOfWeek === 2)

    expect(wednesday).toHaveLength(1)
    expect(wednesday[0]).toMatchObject({ startMinute: 540, endMinute: 900 })
  })

  test('saving again replaces the week, it does not append to it', async () => {
    await save(memberCookie, thisWeek(), [{ dayOfWeek: 3, intervals: [{ start: 720, end: 900 }] }])
    await save(memberCookie, thisWeek(), [{ dayOfWeek: 4, intervals: [{ start: 960, end: 1080 }] }])

    const rows = await ctx.db
      .select()
      .from(availability)
      .where(eq(availability.userId, members[0]!))

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ dayOfWeek: 4, startMinute: 960, endMinute: 1080 })
  })

  test('"free nowhere" is an answer: an answer row with zero intervals', async () => {
    const other = members[1]!
    const cookie = await createSessionCookie(ctx, other)

    expect((await save(cookie, thisWeek(), [])).status).toBe(200)

    const week = (await planner(cookie)).weeks[0]
    expect(week?.answered.sort()).toEqual([members[0]!, other].sort())
    expect(week?.unanswered).toEqual([captainId, ...members.slice(2)])
    expect(week?.availability.some((row) => row.userId === other)).toBe(false)
  })

  test('four of five free is a window; the fifth is named as missing', async () => {
    for (const userId of [captainId, ...members]) {
      await save(await createSessionCookie(ctx, userId), thisWeek(), tuesdayEvening)
    }
    // and then one of them withdraws, so exactly four are left on Tuesday evening
    await save(await createSessionCookie(ctx, members[1]!), thisWeek(), [])

    const tuesday = (await planner(memberCookie)).weeks[0]?.days[1]

    expect(tuesday?.windows).toHaveLength(1)
    expect(tuesday?.windows[0]).toMatchObject({
      start: 1200,
      end: 1380,
      count: 4,
      missing: [members[1]!].sort(),
    })
  })

  test('the second visible week is writable and separate from the first', async () => {
    const sundayMorning = [{ dayOfWeek: 6, intervals: [{ start: 480, end: 540 }] }]

    expect((await save(memberCookie, nextWeek(), sundayMorning)).status).toBe(200)

    const dto = await planner(memberCookie)
    expect(dto.weeks[1]?.availability).toContainEqual({
      userId: members[0]!,
      dayOfWeek: 6,
      startMinute: 480,
      endMinute: 540,
    })
    // the same person's rows in week one are untouched by a write in week two
    expect(dto.weeks[0]?.availability.some((row) => row.dayOfWeek === 6)).toBe(false)
  })
})

describe('PUT refusals', () => {
  test('a 20-minute sliver is a 422 that names the field', async () => {
    const response = await save(memberCookie, thisWeek(), [
      { dayOfWeek: 1, intervals: [{ start: 540, end: 560 }] },
    ])

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      message: 'Invalid availability',
      details: [
        { path: 'days[0].intervals[0].end', message: 'Times must sit on a 30-minute boundary' },
      ],
    })
  })

  test('a week that does not start on a Monday is refused', async () => {
    const wednesday = addDays(thisWeek(), 2)

    expect((await save(memberCookie, wednesday, tuesdayEvening)).status).toBe(422)
  })

  test('a week outside the window is closed, even in the future', async () => {
    const response = await save(memberCookie, addDays(thisWeek(), 21), tuesdayEvening)

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ message: 'That week is closed' })
  })

  test('writing somebody else’s week is a 403, captain or not', async () => {
    const captainCookie = await createSessionCookie(ctx, captainId)
    const response = await call(`/api/teams/alpha/planner/${thisWeek()}`, {
      method: 'PUT',
      cookie: captainCookie,
      body: { userId: members[0], days: tuesdayEvening },
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      message: 'Availability is personal — you can only write your own',
    })
  })

  test('a past week cannot be written back to life', async () => {
    const lastWeek = addDays(thisWeek(), -7)

    expect((await save(memberCookie, lastWeek, tuesdayEvening)).status).toBe(409)
  })
})

describe('the database rules the route relies on', () => {
  test('two saves create one week row, not two', async () => {
    await save(memberCookie, nextWeek(), tuesdayEvening)
    await save(memberCookie, nextWeek(), tuesdayEvening)

    const rows = await ctx.db
      .select()
      .from(weeks)
      .where(and(eq(weeks.teamId, teamId), eq(weeks.startsOn, nextWeek())))

    expect(rows).toHaveLength(1)
  })

  test('an interval that ends before it starts cannot be stored', async () => {
    const [week] = await ctx.db
      .select()
      .from(weeks)
      .where(and(eq(weeks.teamId, teamId), eq(weeks.startsOn, thisWeek())))

    await rejectsWith(
      ctx.db.insert(availability).values({
        id: crypto.randomUUID(),
        weekId: week!.id,
        userId: captainId,
        dayOfWeek: 0,
        startMinute: 720,
        endMinute: 480,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      /availability_minutes_check/,
    )
  })

  test('a second week for the same team and Monday is refused', async () => {
    await rejectsWith(
      ctx.db.insert(weeks).values({
        id: crypto.randomUUID(),
        teamId,
        startsOn: thisWeek(),
        createdBy: captainId,
        createdAt: new Date(),
      }),
      /week_teamId_startsOn_idx/,
    )
  })

  test('a standing schedule is not possible for somebody who is not a member', async () => {
    const stranger = await createUser(ctx, { name: 'Stranger' })

    await rejectsWith(
      ctx.db.insert(availabilityTemplates).values({
        id: crypto.randomUUID(),
        teamId,
        userId: stranger,
        dayOfWeek: 1,
        startMinute: 1200,
        endMinute: 1380,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      /availability_template_membership_fk/,
    )
  })

  test('the answer upsert keeps one row per person per week', async () => {
    for (const userId of everyone()) {
      await save(await createSessionCookie(ctx, userId), thisWeek(), tuesdayEvening)
    }
    await save(memberCookie, thisWeek(), tuesdayEvening)

    const [week] = await ctx.db
      .select()
      .from(weeks)
      .where(and(eq(weeks.teamId, teamId), eq(weeks.startsOn, thisWeek())))
    const rows = (await ctx.db.select().from(answers)).filter((row) => row.weekId === week!.id)
    const mine = rows.filter((row) => row.userId === members[0])

    expect(mine).toHaveLength(1)
    expect(new Set(rows.map((row) => row.userId)).size).toBe(rows.length)
  })
})
