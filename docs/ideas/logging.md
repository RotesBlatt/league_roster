# Idea — logging that answers "did it do the thing?"

**Status:** idea, nothing implemented. Quick win.
**Scope:** backend only (`apps/api`), plus env/docs/docker wiring. No SPA code.

## 1. The idea

Two kinds of log line, one format, two sinks:

- **request log** — one line per HTTP request: what was asked, what came back, how long, who asked.
- **general log** — lifecycle and business events: boot, db, guard denials, invite claim, member
  change, player write, unhandled errors.

Sinks:

- **console** — readable while `bun run dev` is open (`docker compose logs` also works)
- **file** — NDJSON, one object per line, greppable and parseable later

The purpose is not "logging" as a checkbox. It is:

1. **see traffic** — which routes the SPA actually calls, which fail, how often
2. **see outcomes** — status + the API's own error message ("Captain only", "This invite is used up")
3. **debug** — request id, duration, user id, IP, error code + stack for 5xx
4. **verify paths** — a hard refresh on `/roster` must show up as `GET /roster 200` (SPA shell), while
   `/api/nope` must show up as `404`. That is the "does the page path do the right thing" check.

Explicitly *not* an audit log and *not* analytics. It may be rotated away; nothing depends on it.

## 2. What the framework actually gives us

Verified against Elysia **1.4.32** (the installed version) with throwaway probes, because the hook
behaviour decides the design:

| Hook | Use |
| --- | --- |
| `onRequest` | always first: start timer, assign request id, capture IP / method / path / UA |
| `onAfterHandle` | **sees macro-resolved `user` / `me`** → record `userId`, `role`, membership `status` |
| `onError` | error `code`, message, stack (stack only for 5xx) |
| `onAfterResponse` | final status, duration; also runs for `NOT_FOUND` and for `status(401/403)` |

Three findings that shape the code:

- **`onAfterResponse` does not run for a short-circuit `return` in `onRequest`.** Better-auth is
  intercepted exactly there (`app.ts`), so without special handling *every login/session request
  would be invisible*. Those get one explicit wrapper: await the handler, log, return the Response.
- **Derived context is gone in `onAfterResponse`** (`'me' in ctx === false`), but present in
  `onAfterHandle`. So request state lives in a `WeakMap<Request, PendingRequest>`, populated in
  `onRequest`, amended later, flushed in `onAfterResponse`. Request-scoped by construction — no
  `store` mutation, which would leak between requests.
- **Hooks registered inside a plugin used via `.use()` do not fire `onAfterResponse` at all**, and a
  plugin registered twice runs `onRequest` twice (no runtime dedupe by `name`). So this is **not** an
  Elysia plugin: `createRequestLog()` returns plain hook functions that `createApp` chains directly
  on the app instance. Idempotent record creation makes double registration harmless anyway.
- `mapResponse` is *not* the answer: it misses `onRequest` short-circuits and `NOT_FOUND`, and
  reports `set.status` stale (`status(418)` came back as `200`). Confirmed by probe, don't retry it.

## 3. Shape

```text
apps/api/src/lib/log/format.ts   pure: record type, NDJSON line, pretty line, redaction, truncation
apps/api/src/lib/log/sinks.ts    consoleSink + fileSink (daily file, retention, sync append)
apps/api/src/lib/log/logger.ts   createLogger({ level, sinks, clock }) → {debug,info,warn,error,child}
apps/api/src/lib/log/http.ts     createRequestLog(logger) → hook functions + requestLogger() helper
apps/api/src/lib/log/noop.ts     silent logger for tests/optional params (2 lines)
```

No new dependency. Pino/winston would be justified if we ever ship logs off-box or want redaction
plugins; for "one line per request, file + console, daily file" they are ~150 lines of config and a
transitive dependency tree. The sink interface stays narrow enough that swapping in pino later is a
one-file change.

Console (ANSI colours only when `process.stdout.isTTY`). Generic events print as
`time LEVEL event key=value …`; `http.request` gets one compact branch because it is the most
frequent line and its shape is fixed:

```text
14:03:22.418 INFO  GET   /api/players     200  12ms  u:8f3c2a1
14:03:23.002 WARN  PATCH /api/members/x   403   1ms  u:8f3c2a1  "Captain only"
14:03:23.004 WARN  invite.claim_rejected inviteId=… userId=8f3c2a1 reason=used_up
14:03:24.771 ERROR POST  /api/players     500   8ms  err:UNKNOWN  "boom"
```

File `logs/api-2026-02-06.log`:

```json
{"ts":"2026-02-06T14:03:22.418Z","level":"info","event":"http.request","id":"a1b2c3d4","method":"GET","path":"/api/players","status":200,"ms":12,"userId":"8f3c2a1","role":"member","ip":"127.0.0.1","ua":"Mozilla/5.0 …"}
{"ts":"2026-02-06T14:03:23.002Z","level":"warn","event":"invite.claim_rejected","inviteId":"…","userId":"8f3c2a1","reason":"used_up","requestId":"a1b2c3d5"}
```

The base record is always `ts`, `level`, `event`, plus whatever the call site adds. `http.request` is
not a special case in the record or the sink — only the pretty renderer recognises it.

## 4. General-purpose logging

### API

```ts
logger.info('invite.claimed', { inviteId, userId, uses: 1, maxUses: 3 })
logger.error('db.connect_failed', { target, error })
const log = logger.child({ component: 'members' })   // bound fields, same sinks
```

First argument is the event name (dotted, `<area>.<thing>`), second is structured fields. Formatted
output and redaction are identical for every event — there is one logger, not one per feature.

### Event catalogue

Small on purpose. Every event here is something you would actually grep for.

| event | level | fields | emitted from |
| --- | --- | --- | --- |
| `server.start` | info | `port`, `db`, `env`, `authBaseUrl`, `trustedOrigins` | `index.ts` |
| `server.stop` | info | `signal` | `index.ts` (SIGINT/SIGTERM) |
| `db.connect_failed` | error | `target`, hint lines | `index.ts` |
| `db.migrate` | info | `folder`, `ms` | `db/migrate.ts` |
| `http.request` | status-derived | `id`, `method`, `path`, `status`, `ms`, `userId`, `role`, `ip`, `ua`, `message?`, `errorCode?`, `slow?` | `lib/log/http.ts` |
| `auth.denied` | info (`warn` for captain-only) | `guard`, `reason`, `userId?` | `plugins/auth.ts` |
| `auth.bootstrap_promote` | warn | `userId`, `reason` (`allowlist` \| `first_user`) | `lib/access.ts` |
| `invite.created` | info | `inviteId`, `byUserId`, `maxUses`, `expiresAt` | `routes/invites.ts` |
| `invite.claimed` | info | `inviteId`, `userId`, `uses`, `maxUses` | `lib/invites.ts` |
| `invite.claim_rejected` | warn | `userId`, `reason` (`not_found` \| `revoked` \| `expired` \| `used_up`), `inviteId?` | `lib/invites.ts` |
| `invite.revoked` | info | `inviteId`, `byUserId` | `routes/invites.ts` |
| `member.updated` | info | `targetUserId`, `byUserId`, `role?`, `status?` | `routes/members.ts` |
| `member.change_rejected` | warn | `targetUserId`, `byUserId`, `reason` | `routes/members.ts` |
| `player.created` / `player.updated` / `player.deleted` | info | `playerId`, `byUserId` | `routes/players.ts` |
| `process.unhandled_error` | error | `kind`, `error` | `index.ts` |

Resources are identified by **id only** — no player names, notes, emails or Discord ids. The ids are
enough to follow a chain with the DB open, and it keeps the log boring to leak.

### DI, not a singleton

`AGENTS.md`'s rule is that the API receives its dependencies: `createApp({ db, auth })`. The logger
follows it:

- `createApp({ logger })` — default is a logger built from `env`, tests inject one with a memory sink
- `createAuthPlugin({ auth, db, logger })`
- `createPlayerRoutes(db, authPlugin, logger)` / invites / members
- `claimInvite(db, { userId, code, log })`, `ensureAccess(db, userId, allowlist, log)` — optional,
  default `noop`

Composition roots (`index.ts`, `db/migrate.ts`) build the real logger; nothing else constructs one.

### Correlating events with the request

A business event is much more useful with the request id on it. Route handlers already have
`request`, so they call:

```ts
const log = requestLogger(logger, request)   // child logger with { requestId, userId } when known
```

`requestLogger` is a lookup in the same `WeakMap` the hooks use; it returns the base logger when
there is no pending record (unit tests, scripts). Guards call it inside the macro, so
`auth.denied` carries the request id too.

### What disappears

`console.error('[api]', code, error)` in `app.ts` becomes a 5xx `http.request` line with the stack.
The boot `console.info` lines in `index.ts` become `server.start`. **`env.ts` keeps its `console.warn`
lines** — it runs at import time, before any logger exists, and those warnings are one-time config
diagnostics, not request-path logging. That is the single documented exception.

## 5. The request log in detail

Fields: `id`, `method`, `path`, `status`, `ms`, `userId`, `role`, membership `status`, `ip`, `ua`,
`message` (non-2xx only), `errorCode` + `stack` (5xx), `slow` (over `LOG_SLOW_MS`).

Level mapping: `>=500 → error`, `>=400 → warn`, else `info`. `/assets/*` → `debug` (invisible at the
default level) unless `LOG_ASSETS=true`; SPA deep links stay `info` on purpose, that's a signal.

Status extraction, in order: `response instanceof Response ? response.status : Number(set.status)`.
This is what makes `status(403, …)`, thrown errors, `NOT_FOUND` → `serveSpaIndex()` (200) and raw
`new Response(…, {status: 201})` all report the truth.

### Never logged

- `cookie`, `authorization`, any `set-cookie`
- **request bodies, at all** — `/api/auth/*` bodies are credentials; the rest isn't needed
- **invite codes** — a code is a bearer token; logging it in cleartext would let anyone with log
  access join. The invite `id` is logged instead
- response bodies, except the `message` field of our own non-2xx JSON errors (that string is already
  returned to the browser, so it is not a leak)
- the session token inside a better-auth response

Redaction is a pure function with a test, not a comment promising care.

## 6. Env knobs

Parsed in `readEnv` (already injectable/pure, `test/unit/env.test.ts`):

| var | default | meaning |
| --- | --- | --- |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error`; anything else falls back to `info` |
| `LOG_TO_FILE` | `true` | console-only when false (useful in containers) |
| `LOG_DIR` | `logs` | resolved against `REPO_ROOT`, like `WEB_DIST` |
| `LOG_RETENTION_DAYS` | `14` | daily files older than this are deleted on rotation |
| `LOG_ASSETS` | `false` | log served `/assets/*` (huge, useless by default) |
| `LOG_SLOW_MS` | `500` | mark slower requests in the record (`slow:true`) instead of hiding them |

`readEnv` must keep warning only about things a human can act on; the log config is silent.

## 7. Rotation and writing

Daily file, name from the injected clock: `api-YYYY-MM-DD.log`. On a date change, create the new
file and sweep `api-*.log` older than `LOG_RETENTION_DAYS` (string compare on the date part, no
`stat` per write). `appendFileSync` from `node:fs` — at this traffic the cost is irrelevant, and it
cannot lose lines when the process dies. Revisit only if it shows up in request timings.

A sink that throws must never affect the caller: `logger` wraps every sink call, and a unit test
asserts that a broken sink still yields a 200 from a route.

## 8. Tests (test-first, per `AGENTS.md`)

- `test/unit/log-format.test.ts` — NDJSON shape, pretty line, status→level, redaction of
  cookie/authorization, truncation, `Error` serialization (message + stack)
- `test/unit/log-sinks.test.ts` — writes to a tmpdir, appends, rolls at the date boundary, deletes
  only files past retention, swallows write errors
- `test/unit/logger.test.ts` — level filtering, multiple sinks, `child` bound fields, injected clock
- `test/unit/log-http.test.ts` — hook functions against fake contexts: record creation, status
  extraction (object / `Response` / thrown), duration, asset filtering, `requestLogger` binding,
  short-circuit logging
- `test/unit/env.test.ts` — new knobs, defaults, invalid `LOG_LEVEL`
- `test/unit/invites.test.ts` / `access.test.ts` (new, no HTTP) — a fake logger receives
  `invite.claimed` / `invite.claim_rejected` / `auth.bootstrap_promote` with the right fields, and
  **no invite code**
- `test/integration/logging.test.ts` — inject a memory sink into `createApp({ logger })` and assert:
  200 / 401 / 403 / 422 / 404-SPA / better-auth / thrown 500 each emit **exactly one**
  `http.request` with method, path, status, `ms`, `id`; an authenticated call carries `userId`; a
  denied captain route carries `auth.denied` + requestId; `POST /api/invites` emits
  `invite.created`; the response carries `x-request-id`; 5xx is `level:"error"` with a stack; the
  cookie value appears nowhere

Then `bun run test`, `bun run test:db`, `bun run typecheck`, `bun run check`.

## 9. Files touched

| File | Change |
| --- | --- |
| `apps/api/src/lib/log/*` | new (5 files) |
| `apps/api/src/app.ts` | `createApp({ logger })`, chain hook functions, wrap better-auth `onRequest` |
| `apps/api/src/index.ts` | build the logger from `env`, `server.start`, `server.stop`, unhandled errors |
| `apps/api/src/env.ts` | `log` config block |
| `apps/api/src/plugins/auth.ts` | `logger`, `auth.denied`, user stamped onto the request record |
| `apps/api/src/lib/access.ts` | `auth.bootstrap_promote` |
| `apps/api/src/lib/invites.ts` | `invite.claimed` / `invite.claim_rejected` |
| `apps/api/src/routes/{players,invites,members}.ts` | factory takes `logger`, emits its events |
| `apps/api/src/db/migrate.ts` | `db.migrate` |
| `.env.example` | documented knobs |
| `.gitignore` | `logs/` (currently only `*.log`) |
| `docker-compose.yml`, `Dockerfile` | `api-logs` volume + `mkdir/chown /app/logs` for user `bun` |
| `README.md` | "where do the logs go" section |

## 10. Request id

8 hex chars, generated per request; accepted from an inbound `x-request-id` only if it matches
`^[A-Za-z0-9_-]{1,64}$` (otherwise generate — echoing a client-supplied string verbatim is how log
injection happens). Echoed on the response as `x-request-id`, so a UI error can be quoted in a bug
report and found with one `grep`.

## 11. Open questions

1. **Format** — NDJSON file + pretty console, or plain text in both? (recommend NDJSON: the file is
   for machines and `jq`, the console is for eyes)
2. **Rotation** — daily + 14 days, or size-based? (recommend daily; no size cap needed here)
3. **Container** — file logging on inside Docker with a named volume, or console-only there and let
   the `json-file` driver (10m × 3) do the rotating? (recommend the volume: "check the log after the
   fact" is the point)
4. **Event detail** — ids only, as in §4? (recommend yes; names/notes live in the DB)
5. **SPA** — surface `x-request-id` in error toasts? (recommend no for now; it is in the response
   header if we ever want it)

## 12. Suggested commits

1. `feat(api): add structured logger with file sink` — `lib/log/{format,sinks,logger,noop}.ts` + unit
   tests
2. `feat(api): log every http request and its outcome` — `lib/log/http.ts`, `app.ts`, `env.ts`,
   `index.ts`, integration test
3. `feat(api): log domain events` — auth/access/invites/members/players/migrate + their unit tests
4. `chore(docker): persist and rotate api log files` — compose, Dockerfile, gitignore, env example

One idea per commit, each green on its own. 1 and 4 can land without 2–3; 3 depends on 1.

## 13. Deliberately out of scope

- Log shipping (Loki/ELK) — the file is the interface; ship it later without touching call sites
- Metrics/tracing (OpenTelemetry) — a different question with a different cost
- Frontend logging — the browser's console already has the network tab; the server is where the
  decisions happen
- Sensitive-data policy beyond "don't log credentials or invite codes" — no GDPR machinery for a
  hobby team roster
