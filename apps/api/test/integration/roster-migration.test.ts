import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import {
  memberships,
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

  // raw SQL on purpose: `player` was dropped in 0007, so it is not in the schema module any more —
  // this fixture writes into the shape 0006 met in production
  for (const row of [
    {
      id: 'player-linked',
      displayName: 'Jules',
      role: 'MID',
      riotGameName: 'Hide on bush',
      riotTagLine: 'EUW',
      note: 'shotcaller',
      isActive: true,
      userId: member,
    },
    {
      id: 'player-outsider',
      displayName: 'Guest',
      role: 'TOP',
      riotGameName: null,
      riotTagLine: null,
      note: null,
      isActive: true,
      userId: outsider,
    },
    {
      id: 'player-free',
      displayName: 'Sprinter',
      role: 'TOP',
      riotGameName: null,
      riotTagLine: null,
      note: null,
      isActive: false,
      userId: null,
    },
  ]) {
    await ctx.db.execute(sql`
      insert into "player" ("id", "displayName", "role", "riotGameName", "riotTagLine", "note",
                            "isActive", "userId", "teamId", "createdAt", "updatedAt")
      values (${row.id}, ${row.displayName}, ${row.role}, ${row.riotGameName}, ${row.riotTagLine},
              ${row.note}, ${row.isActive}, ${row.userId}, ${teamId},
              ${now.toISOString()}, ${now.toISOString()})
    `)
  }

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

  test('0006 lifts the Riot ID into an account; 0010 then removes it for having no puuid', async () => {
    // The chain ends without it on purpose: a migrated label is not an identity, and since 0010
    // `puuid` is required. Anyone whose old row is dropped re-adds the account once, resolved.
    expect(await ctx.db.select().from(riotAccounts).where(eq(riotAccounts.userId, member))).toEqual(
      [],
    )
  })

  test('0008 linked the main account; 0010 clears that link, not the roster entry', async () => {
    const [entry] = await ctx.db.select().from(rosterEntries)

    // the foreign key is ON DELETE SET NULL, so the captain keeps his entry and picks again
    expect(entry?.accountId ?? null).toBeNull()
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
