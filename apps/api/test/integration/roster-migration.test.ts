import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import {
  memberships,
  players,
  profile,
  riotAccounts,
  rosterEntries,
  teams,
  user,
} from '../../src/db/schema.ts'
import { createTestContext, migrateTo, migrationsFolder, type TestContext } from './helpers.ts'

/**
 * The migration that splits the captain-owned `player` row (player-profiles.md §2).
 *
 * The interesting part is the backfill, not the DDL: a roster entry must survive, and it must only
 * exist for someone who is **a member of that team** — `roster_entry.userId` is NOT NULL and points
 * at `membership (teamId, userId)`, so the database refuses the alternative.
 *
 * Generic replay (`migrations.test.ts`) proves rows survive; this proves they were transformed,
 * and that the ones which cannot be transformed are left alone rather than guessed at.
 */
let ctx: TestContext

/** 0000…0005: the schema as it shipped before the split. */
const BEFORE_SPLIT = 6

const teamId = 'team-1'
const member = 'user-member'
const outsider = 'user-outsider'
const freeTyped = 'player-free'

beforeAll(async () => {
  ctx = await createTestContext({ migrate: false })
  await migrateTo(ctx.db, BEFORE_SPLIT)

  const now = new Date('2026-01-01T00:00:00.000Z')
  await ctx.db.insert(user).values([
    {
      id: member,
      name: 'Julius',
      email: 'julius@test.local',
      emailVerified: false,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: outsider,
      name: 'Someone Else',
      email: 'else@test.local',
      emailVerified: false,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
  ])
  await ctx.db.insert(teams).values({
    id: teamId,
    name: 'Die Besten',
    shortName: 'DBW',
    slug: 'dbw',
    createdAt: now,
    createdBy: member,
  })
  await ctx.db.insert(memberships).values({
    id: 'membership-member',
    teamId,
    userId: member,
    role: 'captain',
    status: 'active',
    joinedAt: now,
    updatedAt: now,
  })

  await ctx.db.insert(players).values([
    {
      id: 'player-linked',
      displayName: 'Jules',
      role: 'MID',
      riotGameName: 'Hide on bush',
      riotTagLine: 'EUW',
      note: 'shotcaller',
      isActive: true,
      userId: member,
      teamId,
      createdAt: now,
      updatedAt: now,
    },
    {
      // linked to a user who is not a member of this team: no entry may be created for them
      id: 'player-outsider',
      displayName: 'Guest',
      role: 'TOP',
      riotGameName: null,
      riotTagLine: null,
      note: null,
      isActive: true,
      userId: outsider,
      teamId,
      createdAt: now,
      updatedAt: now,
    },
    {
      // someone the captain typed in that never had an account at all
      id: freeTyped,
      displayName: 'Sprinter',
      role: 'TOP',
      riotGameName: null,
      riotTagLine: null,
      note: null,
      isActive: false,
      userId: null,
      teamId,
      createdAt: now,
      updatedAt: now,
    },
  ])

  await migrate(ctx.db, { migrationsFolder })
})

afterAll(async () => {
  await ctx.drop()
})

describe('0006 — player is split into roster_entry, profile and riot_account', () => {
  test('a member’s player row survives as a roster entry with the captain-owned fields', async () => {
    const entries = await ctx.db.select().from(rosterEntries)
    expect(entries.map((entry) => entry.id)).toEqual(['player-linked'])

    expect(entries[0]).toMatchObject({
      teamId,
      userId: member,
      note: 'shotcaller',
      isActive: true,
      // the position becomes an override: the player now owns the preference
      roleOverride: 'MID',
    })
  })

  test('a row whose user is not a member is not carried over', async () => {
    const entries = await ctx.db.select().from(rosterEntries)
    expect(entries.map((entry) => entry.id)).not.toContain('player-outsider')

    // and nothing is invented for them either — the three backfills agree on who is a member
    expect(await ctx.db.select().from(profile).where(eq(profile.userId, outsider))).toHaveLength(0)
  })

  test('a free-typed row (no login at all) cannot become a roster entry', async () => {
    const entries = await ctx.db.select().from(rosterEntries)
    expect(entries.map((entry) => entry.id)).not.toContain(freeTyped)
  })

  test('the player-owned fields are lifted into a profile, not thrown away', async () => {
    const [row] = await ctx.db.select().from(profile).where(eq(profile.userId, member))

    expect(row).toMatchObject({
      displayName: 'Jules',
      preferredRole: 'MID',
      // no birthday was ever asked for, and a migration must not invent one
      birthday: null,
    })
  })

  test('the Riot ID becomes a main account, unverified', async () => {
    const [account] = await ctx.db
      .select()
      .from(riotAccounts)
      .where(eq(riotAccounts.userId, member))

    expect(account).toMatchObject({
      gameName: 'Hide on bush',
      tagLine: 'EUW',
      isMain: true,
      // the migration cannot call Riot; verified is a claim only the API may make
      verifiedAt: null,
    })
  })

  test('the database refuses a roster entry without a user', async () => {
    let code: string | undefined
    try {
      await ctx.db.execute(sql`
        insert into "roster_entry" ("id", "teamId", "note", "isActive", "createdAt", "updatedAt")
        values ('nobody', ${teamId}, null, true, now(), now())
      `)
    } catch (error) {
      code = (error as { cause?: { code?: string }; code?: string }).cause?.code
    }

    // 23502 = not_null_violation: "always a member" is a database rule, not a convention
    expect(code).toBe('23502')
  })
})
