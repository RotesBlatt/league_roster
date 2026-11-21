import { isPlatform } from '@lol/shared'
import { Elysia, t } from 'elysia'
import type { Logger } from '../lib/log/logger.ts'
import { noopLogger } from '../lib/log/noop.ts'
import {
  normalizeRiotAccountId,
  RIOT_GAME_NAME_MAX,
  RIOT_TAG_LINE_MAX,
} from '../lib/riot-accounts.ts'
import type { AuthPlugin } from '../plugins/auth.ts'
import type { RiotClient } from '../riot/client.ts'
import type { RiotError } from '../riot/mappers.ts'
import type { Throttle } from '../riot/throttle.ts'

/**
 * The explicit "Check" (riot-api.md §4): one press, one composed lookup, nothing written. Per
 * keystroke this would be 12 validations for a 12-character name, against a budget the whole
 * server shares.
 *
 * The route knows no hosts, no payloads and no status codes — the client answers a `RiotError`
 * kind, and the table below is the only place a sentence is chosen (§6). Each sentence is
 * different because each one tells a different person what to fix.
 */

const body = t.Object({
  gameName: t.String({ maxLength: RIOT_GAME_NAME_MAX }),
  tagLine: t.String({ maxLength: RIOT_TAG_LINE_MAX }),
  platform: t.String({ maxLength: 8 }),
})

const UNAVAILABLE = 'Riot check is unavailable — you can still save the account'

const SENTENCES: Record<RiotError['kind'], { status: number; message: string }> = {
  // "name, tag and platform" in one sentence because a wrong platform *is* indistinguishable
  not_found: {
    status: 404,
    message: 'No such Riot ID on that platform — check name, tag and platform',
  },
  bad_request: { status: 422, message: 'Riot rejected that Riot ID' },
  rate_limited: { status: 429, message: 'Too many Riot checks — try again in a moment' },
  // the key, not the player: the same advice for all three, and saving still works
  forbidden: { status: 503, message: UNAVAILABLE },
  unavailable: { status: 503, message: UNAVAILABLE },
  timeout: { status: 503, message: UNAVAILABLE },
}

export function createRiotLookupRoutes(
  riot: RiotClient,
  throttle: Throttle,
  authPlugin: AuthPlugin,
  requestLogger?: (request: Request) => Logger,
) {
  return new Elysia({ prefix: '/me/riot-accounts' }).use(authPlugin).post(
    '/lookup',
    async ({ body, me, status, request, set }) => {
      const id = normalizeRiotAccountId(body)
      if (id.problems.length > 0) {
        return status(422, {
          message: 'Invalid Riot ID',
          details: id.problems.map((problem) => ({
            path: problem.field,
            message: problem.message,
          })),
        })
      }

      if (!isPlatform(body.platform)) {
        return status(422, {
          message: 'Invalid platform',
          details: [{ path: 'platform', message: 'Unknown platform' }],
        })
      }

      // our own budget guard runs before Riot: a denied press must cost zero requests
      const decision = throttle.take(me.id)
      if (!decision.allowed) {
        set.headers['retry-after'] = String(decision.retryAfterSeconds)
        return status(429, {
          message: SENTENCES.rate_limited.message,
          retryAfterSeconds: decision.retryAfterSeconds,
        })
      }

      const result = await riot.lookupAccount({ ...id.values, platform: body.platform })
      const log = requestLogger?.(request) ?? noopLogger

      if (!result.ok) {
        const sentence = SENTENCES[result.error.kind]

        // Riot's own Retry-After is the only useful thing in a 429 body or header
        if (result.error.kind === 'rate_limited' && result.error.retryAfterSeconds !== null) {
          set.headers['retry-after'] = String(result.error.retryAfterSeconds)
        }

        log.warn('riot.lookup_failed', { userId: me.id, kind: result.error.kind })
        return status(sentence.status, { message: sentence.message })
      }

      // the snapshot is a preview only: a save re-resolves server-side and writes it (§5)
      log.info('riot.lookup', {
        userId: me.id,
        platform: body.platform,
        partial: result.partial,
      })

      return { account: result.account, partial: result.partial }
    },
    { auth: true, body },
  )
}

export type RiotLookupRoutes = ReturnType<typeof createRiotLookupRoutes>
