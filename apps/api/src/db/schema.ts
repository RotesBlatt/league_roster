import { MEMBER_STATUSES, ROLES, USER_ROLES } from '@lol/shared'
import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/**
 * Postgres schema.
 * Better Auth core tables (user / session / account / verification) use the exact field
 * names @better-auth/drizzle-adapter expects for provider "pg".
 */

const createdAt = timestamp('createdAt', { withTimezone: true, mode: 'date' })
const updatedAt = timestamp('updatedAt', { withTimezone: true, mode: 'date' })

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),
  createdAt: createdAt.notNull(),
  updatedAt: updatedAt.notNull(),
})

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expiresAt', { withTimezone: true, mode: 'date' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: createdAt.notNull(),
    updatedAt: updatedAt.notNull(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('session_userId_idx').on(table.userId)],
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    idToken: text('idToken'),
    accessTokenExpiresAt: timestamp('accessTokenExpiresAt', { withTimezone: true, mode: 'date' }),
    refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', { withTimezone: true, mode: 'date' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt.notNull(),
    updatedAt: updatedAt.notNull(),
  },
  (table) => [index('account_userId_idx').on(table.userId)],
)

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expiresAt', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: createdAt,
    updatedAt: updatedAt,
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
)

/**
 * What a player says about themselves — one row per person, global, and independent of any team.
 * Player-owned (player-profiles.md §2): the roster entry a captain writes is a different table.
 *
 * No row at all means "never set up"; the profile is then judged complete by
 * `missingProfileFields` in @lol/shared, never by a stored flag.
 */
export const profile = pgTable('profile', {
  id: text('id').primaryKey(),
  userId: text('userId')
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: 'cascade' }),
  displayName: text('displayName').notNull(),
  /** Position preference (TOP…SUP), not the permission — that is `membership.role`. */
  preferredRole: text('preferredRole', { enum: ROLES }).notNull(),
  /**
   * `YYYY-MM-DD`: a birthday is a wall-clock date, so it must not become an instant.
   * **Nullable on purpose** — it is personal data, and someone who declines to share it must
   * not be nagged or forced to invent a date. A null birthday is not "incomplete"; it is a person
   * who chose not to say, and the birthday list simply skips them.
   */
  birthday: date('birthday', { mode: 'string' }),
  updatedAt: updatedAt.notNull(),
})

/**
 * A League account the player owns. Several per person, **at most one main**.
 *
 * The main is a partial unique index rather than a `mainAccountId` on `profile`: the latter can
 * point at nothing, or at another user's account, after two independent updates.
 *
 * `puuid` is Riot's stable identity (renames change the Riot ID); it stays NULL until validation
 * exists, and becomes required the moment it does — see docs/ideas/integrations/riot-api.md.
 */
export const riotAccounts = pgTable(
  'riot_account',
  {
    id: text('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    gameName: text('gameName').notNull(),
    tagLine: text('tagLine').notNull(),
    /** Platform code (`euw1`, `eun1`, …) — decides which host answers summoner/rank later. */
    platform: text('platform').notNull().default('euw1'),
    puuid: text('puuid'),
    isMain: boolean('isMain').notNull().default(false),
    /** null = typed in, never checked against Riot: shown as "unverified", not as an error. */
    verifiedAt: timestamp('verifiedAt', { withTimezone: true, mode: 'date' }),
    fetchedAt: timestamp('fetchedAt', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt.notNull(),
  },
  (table) => [
    // the label is unique per person; the same label may exist for two people until one proves it
    unique('riot_account_userId_riot_id_idx').on(table.userId, table.gameName, table.tagLine),
    uniqueIndex('riot_account_one_main_idx').on(table.userId).where(sql`${table.isMain}`),
  ],
)

/**
 * A person's place on **one team's** roster — the captain-owned half of the split
 * (player-profiles.md §2). The player owns `profile` and `riot_account`; the captain owns the note,
 * whether the entry is active, and may override the position the player stated.
 *
 * There is deliberately no `displayName` and no Riot ID here: those live on the profile, so a
 * player editing them shows up in the roster without a sync step — by construction, not by a job.
 *
 * `userId` is **not** nullable: a roster entry is a member of the team, always. That is enforced in
 * the database by a composite foreign key onto `membership (teamId, userId)` rather than trusted to
 * a route, and it cascades — leaving the team removes the entry without a cleanup job
 * (player-profiles.md §9.4). A captain can no longer type in somebody who has not joined.
 */
export const rosterEntries = pgTable(
  'roster_entry',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: text('userId').notNull(),
    note: text('note'),
    /** null → the team uses the player's own `profile.preferredRole`. */
    roleOverride: text('roleOverride', { enum: ROLES }),
    isActive: boolean('isActive').notNull().default(true),
    createdAt: createdAt.notNull(),
    updatedAt: updatedAt.notNull(),
  },
  (table) => [
    // one entry per person per team — meaningful now that userId cannot be null
    unique('roster_entry_teamId_userId_idx').on(table.teamId, table.userId),
    index('roster_entry_teamId_idx').on(table.teamId),
    // "on the roster" and "is a member" are the same fact, so the database says so. It targets
    // membership's existing UNIQUE (teamId, userId); a user leaving removes the entry by cascade.
    foreignKey({
      columns: [table.teamId, table.userId],
      foreignColumns: [memberships.teamId, memberships.userId],
      name: 'roster_entry_membership_fk',
    }).onDelete('cascade'),
  ],
)

/**
 * The **old** roster row: captain-owned from top to bottom, one per team, with the player's own
 * fields duplicated onto it. Kept while `roster_entry` is adopted (0006 backfills it); it is
 * dropped in a later migration, never in the one that stops writing to it.
 */
export const players = pgTable(
  'player',
  {
    id: text('id').primaryKey(),
    displayName: text('displayName').notNull(),
    role: text('role', { enum: ROLES }).notNull(),
    riotGameName: text('riotGameName'),
    riotTagLine: text('riotTagLine'),
    note: text('note'),
    isActive: boolean('isActive').notNull().default(true),
    userId: text('userId').references(() => user.id, { onDelete: 'set null' }),
    teamId: text('teamId')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    createdAt: createdAt.notNull(),
    updatedAt: updatedAt.notNull(),
  },
  (table) => [index('player_role_idx').on(table.role, table.teamId)],
)

/** A team of players. */
export const teams = pgTable(
  'team',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** a few characters, for badges and the switcher: "DBW". Optional. */
    shortName: text('shortName'),
    slug: text('slug').notNull().unique(),
    createdAt: createdAt.notNull(),
    createdBy: text('createdBy')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
  },
  (table) => [index('team_name_idx').on(table.name)],
)

/** Maps a user to a team. */
export const memberships = pgTable(
  'membership',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role', { enum: USER_ROLES }).notNull().default('member'),
    status: text('status', { enum: MEMBER_STATUSES }).notNull().default('active'),
    joinedAt: timestamp('joinedAt', { withTimezone: true, mode: 'date' }).notNull(),
    updatedAt: updatedAt.notNull(),
  },
  (table) => [unique('membership_teamId_userId_idx').on(table.teamId, table.userId)],
)

/** Shareable invite links. `code` is what goes into /join/<code>. */
export const invites = pgTable(
  'invite',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull().unique(),
    note: text('note'),
    createdBy: text('createdBy')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    maxUses: integer('maxUses').notNull().default(1),
    uses: integer('uses').notNull().default(0),
    teamId: text('teamId')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expiresAt', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revokedAt', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt.notNull(),
  },
  (table) => [index('invite_code_idx').on(table.code)],
)

export type UserRow = typeof user.$inferSelect
export type ProfileRow = typeof profile.$inferSelect
export type RosterEntryRow = typeof rosterEntries.$inferSelect
export type RiotAccountRow = typeof riotAccounts.$inferSelect
export type PlayerRow = typeof players.$inferSelect
export type InviteRow = typeof invites.$inferSelect
