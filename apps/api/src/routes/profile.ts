import { DISPLAY_NAME_MAX } from '@lol/shared'
import { eq } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import type { Db } from '../db/index.ts'
import { profile } from '../db/schema.ts'
import type { Logger } from '../lib/log/logger.ts'
import { noopLogger } from '../lib/log/noop.ts'
import { normalizeProfileInput, parseRole, todayIso, toProfileDto } from '../lib/profile.ts'
import type { AuthPlugin } from '../plugins/auth.ts'

/**
 * The body a save takes. Bounds only; the real rules live in `lib/profile.ts`.
 *
 * Unknown keys are stripped by Elysia's validator (`additionalProperties: false` is a no-op in
 * this build — verified in isolation). What keeps that harmless is the handler: it never spreads
 * `body`, it writes the three normalised fields below and nothing else.
 */
const profileBody = t.Object({
  displayName: t.String({ maxLength: DISPLAY_NAME_MAX }),
  /** Checked by `parseRole`, not by a schema union — see the note there. */
  preferredRole: t.String({ maxLength: 16 }),
  /** `YYYY-MM-DD`, or omitted/empty when the player declines to share it. */
  birthday: t.Optional(t.Union([t.String(), t.Null()])),
})

/**
 * The player's own profile. **Global, not team-scoped**: no `:slug` in the path, no `forTeam`
 * handle — this row belongs to a person, not to a team (player-profiles.md §2).
 *
 * Guard is `{ auth: true }` on purpose: a signed-in user who is in no team yet must be able to
 * complete their profile, otherwise the onboarding flow deadlocks (§5).
 */
export function createProfileRoutes(
  db: Db,
  authPlugin: AuthPlugin,
  requestLogger?: (request: Request) => Logger,
) {
  return (
    new Elysia({ prefix: '/me' })
      .use(authPlugin)
      /** `null` means "never set up" — a valid answer, not a 404. */
      .get(
        '/profile',
        async ({ me }) => {
          const [row] = await db.select().from(profile).where(eq(profile.userId, me.id)).limit(1)

          return row ? toProfileDto(row) : null
        },
        { auth: true },
      )
      /**
       * Full replace, so it is a PUT: the form always submits every field, and there is no
       * "which fields were omitted" ambiguity. Upsert keyed on the UNIQUE `userId`.
       */
      .put(
        '/profile',
        async ({ body, me, status, request }) => {
          const preferredRole = parseRole(body.preferredRole)
          if (!preferredRole) {
            return status(422, {
              message: 'Invalid profile',
              details: [{ path: 'preferredRole', message: 'Unknown role' }],
            })
          }

          const { values, problems } = normalizeProfileInput({ ...body, preferredRole }, todayIso())
          if (problems.length > 0) {
            return status(422, {
              message: 'Invalid profile',
              // same shape the schema validator produces, so the form reads one thing
              details: problems.map((problem) => ({
                path: problem.field,
                message: problem.message,
              })),
            })
          }

          const now = new Date()
          const [row] = await db
            .insert(profile)
            .values({
              id: crypto.randomUUID(),
              // never from the body: a save can only ever write the caller's own row
              userId: me.id,
              ...values,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: profile.userId,
              set: { ...values, updatedAt: now },
            })
            .returning()

          if (!row) return status(500, { message: 'Could not save profile' })

          const log = requestLogger?.(request) ?? noopLogger
          // the name is personal data the log does not need; the role is the useful signal
          log.info('profile.updated', {
            userId: me.id,
            preferredRole: values.preferredRole,
            hasBirthday: values.birthday !== null,
          })

          return toProfileDto(row)
        },
        { auth: true, body: profileBody },
      )
  )
}

export type ProfileRoutes = ReturnType<typeof createProfileRoutes>
