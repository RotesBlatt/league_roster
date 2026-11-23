import { DIVISIONS, MEMBER_STATUSES, ROLES, TIERS, USER_ROLES } from '@lol/shared'
import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sqlStringList } from './enum-list.ts'

/**
 * Postgres schema.
 * Better Auth core tables (user / session / account / verification) use the exact field
 * names @better-auth/drizzle-adapter expects for provider "pg".
 */

const createdAt = timestamp('createdAt', { withTimezone: true, mode: 'date' })
const updatedAt = timestamp('updatedAt', { withTimezone: true, mode: 'date' })

/**
 * `CHECK (col IN (…))` whose value list is generated from the shared array (quick-wins.md D1).
 *
 * The alternative — typing the values out here — is the duplication trap B2 already bit us with:
 * it is right on the day it is written and drifts silently afterwards. With this, adding a role is
 * one edit in `@lol/shared` plus `bun run db:generate`.
 *
 * `sql.raw` because a migration is DDL: there is no statement to bind a parameter to, so the
 * quoted list has to be part of the SQL text.
 */
const enumCheck = (name: string, column: AnyPgColumn, values: readonly string[]) =>
  check(name, sql`${column} in ${sql.raw(sqlStringList(values))}`)

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
export const profile = pgTable(
  'profile',
  {
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
  },
  // the position is one of five; a raw SQL write must not be able to invent a sixth
  (table) => [enumCheck('profile_preferredRole_check', table.preferredRole, ROLES)],
)

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
    /**
     * Riot's stable identity. **Required**: an account is only stored when Riot resolved it, so
     * there is no such thing as a row without one (decided 2026-11-21, see the docs patch —
     * it reverses "degrade, never block" for adding an account).
     */
    puuid: text('puuid').notNull(),
    /**
     * The snapshot (riot-api.md §8): only facts we cannot recompute. Nullable throughout — an
     * account Riot could not be reached for is a valid row, and "unverified" is a badge, not an
     * error. Both queues are stored independently: solo-only is the common case.
     */
    summonerLevel: integer('summonerLevel'),
    profileIconId: integer('profileIconId'),
    soloTier: text('soloTier', { enum: TIERS }),
    soloDivision: text('soloDivision', { enum: DIVISIONS }),
    flexTier: text('flexTier', { enum: TIERS }),
    flexDivision: text('flexDivision', { enum: DIVISIONS }),
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
    // the snapshot's vocabulary is Riot's, but the columns are plain text: without these, a typo in
    // a mapping is stored and only shows up as a missing rank badge
    enumCheck('riot_account_soloTier_check', table.soloTier, TIERS),
    enumCheck('riot_account_soloDivision_check', table.soloDivision, DIVISIONS),
    enumCheck('riot_account_flexTier_check', table.flexTier, TIERS),
    enumCheck('riot_account_flexDivision_check', table.flexDivision, DIVISIONS),
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
    /**
     * The account this player uses **for this team** — his main is not necessarily the one he
     * plays here. null falls back to his main account (`composeRoster`), and deleting the account
     * clears the choice rather than the whole entry.
     */
    accountId: text('accountId').references(() => riotAccounts.id, { onDelete: 'set null' }),
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
    enumCheck('roster_entry_roleOverride_check', table.roleOverride, ROLES),
  ],
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
    /**
     * The IANA zone the planner speaks in. Availability is wall clock (§3 of
     * availability-planner.md), so the team carries the zone and every render uses it — a DST
     * switch must not move everybody's evening by an hour.
     */
    timezone: text('timezone').notNull().default('Europe/Berlin'),
    /**
     * The captain's manual skip-ahead: a floor for the derived window (§5). `max(today, floor)`
     * is self-healing — once the calendar catches up the skip stops mattering, and null means
     * "this week". Never a counter, which would leave a team permanently ahead.
     */
    plannerStart: date('plannerStart', { mode: 'string' }),
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
  (table) => [
    unique('membership_teamId_userId_idx').on(table.teamId, table.userId),
    // the two columns the whole permission model reads: Elysia validates them on the way in, the
    // assignability of `role: 'captain '` in the other direction is what this catches
    enumCheck('membership_role_check', table.role, USER_ROLES),
    enumCheck('membership_status_check', table.status, MEMBER_STATUSES),
  ],
)

/**
 * Shareable invite links. `code` is what goes into /join/<code>.
 *
 * `code` is UNIQUE, and in Postgres that *is* a btree index — a second plain index on the same
 * column would only cost writes (dropped in 0014).
 */
export const invites = pgTable('invite', {
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
})

/**
 * One planning week of one team. Kept as a table even though the window is derived (§5): it is the
 * FK anchor for availability, the home of per-week metadata (`unlockedAt`), and its UNIQUE makes
 * lazy creation idempotent (`INSERT … ON CONFLICT DO NOTHING`), so no cron has to provision it.
 *
 * `startsOn` is always a Monday. Nothing is ever deleted: a week that leaves the window is history.
 */
export const weeks = pgTable(
  'week',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    startsOn: date('startsOn', { mode: 'string' }).notNull(),
    createdBy: text('createdBy')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: createdAt.notNull(),
    /** Captain opened a past week for writing. Gates editing only, never visibility (§5). */
    unlockedAt: timestamp('unlockedAt', { withTimezone: true, mode: 'date' }),
    /**
     * Captain's statement "we looked, there is nothing this week" (§12.11). Not a skip: the
     * window does not move, and answers/windows are kept — this only labels the week.
     */
    noPractice: boolean('noPractice').notNull().default(false),
  },
  (table) => [unique('week_teamId_startsOn_idx').on(table.teamId, table.startsOn)],
)

/**
 * "I answered this week" — separate from availability on purpose (§4). Someone free nowhere has
 * zero availability rows either way; without this row, "I answered: nothing" and "I forgot" are
 * the same thing, and the captain cannot chase the people he actually needs to chase.
 */
export const answers = pgTable(
  'answer',
  {
    id: text('id').primaryKey(),
    weekId: text('weekId')
      .notNull()
      .references(() => weeks.id, { onDelete: 'cascade' }),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    submittedAt: timestamp('submittedAt', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [unique('answer_weekId_userId_idx').on(table.weekId, table.userId)],
)

/**
 * A member's free stretches in one week, in minutes from midnight on the team's wall clock.
 *
 * Half-open `[startMinute, endMinute)`, with `endMinute = 1440` meaning "until midnight" —
 * deliberately not 0, which would be a zero-length interval or a wrap (§3). The CHECKs are the
 * same rule the write path enforces, so a bad interval cannot exist even if a route forgets.
 *
 * `dayOfWeek` is relative to `week.startsOn`; storing an absolute date per interval would
 * duplicate that anchor and let the two drift.
 */
export const availability = pgTable(
  'availability',
  {
    id: text('id').primaryKey(),
    weekId: text('weekId')
      .notNull()
      .references(() => weeks.id, { onDelete: 'cascade' }),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    dayOfWeek: integer('dayOfWeek').notNull(),
    startMinute: integer('startMinute').notNull(),
    endMinute: integer('endMinute').notNull(),
    createdAt: createdAt.notNull(),
    updatedAt: updatedAt.notNull(),
  },
  (table) => [
    index('availability_weekId_idx').on(table.weekId),
    check('availability_dayOfWeek_check', sql`${table.dayOfWeek} between 0 and 6`),
    check(
      'availability_minutes_check',
      sql`${table.startMinute} >= 0 and ${table.endMinute} <= 1440 and ${table.endMinute} > ${table.startMinute}`,
    ),
  ],
)

/**
 * A member's standing times — "Tuesdays 20:00–23:00, every week" (§4b). A template, never a live
 * join: an unanswered week is *shown* with these cells, and the first save writes them into
 * `availability` as ordinary rows. So editing the template can only affect weeks nobody has
 * answered yet, and the aggregation reads exactly one table.
 *
 * Per team per user, not on `profile`: two teams may meet on different evenings. The composite FK
 * onto `membership` makes "has a standing schedule here" and "is a member here" the same fact,
 * the same way `roster_entry` does — leaving the team removes the template.
 */
export const availabilityTemplates = pgTable(
  'availability_template',
  {
    id: text('id').primaryKey(),
    teamId: text('teamId')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: text('userId').notNull(),
    dayOfWeek: integer('dayOfWeek').notNull(),
    startMinute: integer('startMinute').notNull(),
    endMinute: integer('endMinute').notNull(),
    createdAt: createdAt.notNull(),
    updatedAt: updatedAt.notNull(),
  },
  (table) => [
    index('availability_template_teamId_userId_idx').on(table.teamId, table.userId),
    foreignKey({
      columns: [table.teamId, table.userId],
      foreignColumns: [memberships.teamId, memberships.userId],
      name: 'availability_template_membership_fk',
    }).onDelete('cascade'),
    check('availability_template_dayOfWeek_check', sql`${table.dayOfWeek} between 0 and 6`),
    check(
      'availability_template_minutes_check',
      sql`${table.startMinute} >= 0 and ${table.endMinute} <= 1440 and ${table.endMinute} > ${table.startMinute}`,
    ),
  ],
)

/**
 * One patch we hold champion labels for (hexserve-champion-data.md §4, §5). Retention keeps two,
 * so this table normally has two rows — and it is where the patch's own facts live, once:
 *
 * - `publishedAt` / `publishedAtTimestamp` are `version.json`'s `lastUpdate` / `timestamp`: when
 *   the dump published the patch. **`publishedAtTimestamp` is the only ordering key retention may
 *   use** — `16.9.1` sorts after `16.10.1` as text (§5 trap #2), and a column cannot fall into it.
 * - `fetchedAt` is when we last pulled this patch's champion list. It belongs here rather than on
 *   the 173 label rows, which would store one fact 173 times.
 *
 * Storing these is what lets a page still say "Patch 16.23.1, published 19.11." while the dump is
 * unreachable (§7) — the fallback is the rows we already have, not a live read that just failed.
 */
export const championPatches = pgTable('champion_patch', {
  /** The full patch (`16.23.1`) — the directory name, not the icon path's `16.23`. */
  patch: text('patch').primaryKey(),
  publishedAt: timestamp('publishedAt', { withTimezone: true, mode: 'date' }).notNull(),
  publishedAtTimestamp: integer('publishedAtTimestamp').notNull(),
  fetchedAt: timestamp('fetchedAt', { withTimezone: true, mode: 'date' }).notNull(),
})

/**
 * The champion cache itself (hexserve-champion-data.md §4, §5) — the one cache in this design that
 * earns its table: a fixed snapshot whose invalidation trigger has a name (*a new version in
 * `version.json`*), so it is never invalidated by time.
 *
 * **Two patches at once**, hence the composite primary key: on patch day tonight's games were
 * played on yesterday's version, and the older rows are the lookup safety net. A single-column key
 * on `championId` would look correct on an empty database and destroy half the cache on the first
 * refresh.
 *
 * The cascade to `champion_patch` makes pruning one statement — delete the patch, its labels
 * follow — and makes a label that belongs to no patch impossible rather than merely unlikely.
 *
 * Nothing else points here: a match or a pool entry that references a champion id this dump does
 * not know is accepted and rendered as unknown (§8). **We store ids, we render labels** — no
 * champion name or icon is ever copied onto the row that references it.
 *
 * `iconUrl` is stored as the dump gives it: it points at CommunityDragon and its path segment is
 * `major.minor` while the directory is the full patch, which must not be derived by string surgery.
 */
export const champions = pgTable(
  'champion',
  {
    /** The full patch (`16.23.1`) — the directory name, not the icon path's `16.23`. */
    patch: text('patch').notNull(),
    /** The dump's numeric `id`, which is what Riot's match data references (not `key`). */
    championId: integer('championId').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    iconUrl: text('iconUrl').notNull(),
    /** Hints only, never a filter (§9.5); absent in the dump becomes an empty list. */
    positions: text('positions').array().notNull().default(sql`'{}'::text[]`),
    roles: text('roles').array().notNull().default(sql`'{}'::text[]`),
    /** The locale the names were fetched in — `en_US` today, a column so it is not a schema change later. */
    locale: text('locale').notNull().default('en_US'),
  },
  (table) => [
    primaryKey({ columns: [table.patch, table.championId] }),
    // the read resolves one label per id across the retained patches, so it filters on the id
    index('champion_championId_idx').on(table.championId),
    foreignKey({
      columns: [table.patch],
      foreignColumns: [championPatches.patch],
      name: 'champion_patch_fk',
    }).onDelete('cascade'),
  ],
)

export type UserRow = typeof user.$inferSelect
export type ProfileRow = typeof profile.$inferSelect
export type RosterEntryRow = typeof rosterEntries.$inferSelect
export type RiotAccountRow = typeof riotAccounts.$inferSelect
export type InviteRow = typeof invites.$inferSelect
export type WeekRow = typeof weeks.$inferSelect
export type AnswerRow = typeof answers.$inferSelect
export type AvailabilityRow = typeof availability.$inferSelect
export type AvailabilityTemplateRow = typeof availabilityTemplates.$inferSelect
export type ChampionRow = typeof champions.$inferSelect
export type ChampionPatchRow = typeof championPatches.$inferSelect
