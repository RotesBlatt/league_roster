import { MEMBER_STATUSES, ROLES, USER_ROLES } from '@lol/shared'
import { boolean, index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'

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

/** One row per person on the roster. Optionally linked to a login. */
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
export type PlayerRow = typeof players.$inferSelect
export type InviteRow = typeof invites.$inferSelect
