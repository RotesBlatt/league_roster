# Idea — reactive UI (edits show up for everyone at once)

**Status:** idea, nothing implemented.
**Answer up front:** not a break, and the cheap version is genuinely cheap — but only if it is built
as *"a push that says 'refetch'"* and never as *"state sync over the wire"*. The schema does not
change at all. The one recurring cost is per-route discipline (§6), and there is a structural way to
avoid it if it rots.
**Touches:** `plugins/auth.ts` (session read on a long-lived request), `app.ts` (inject a bus +
one new route group), `main.tsx` (`refetchOnWindowFocus`), `hooks.ts` / new `realtime.ts` in the SPA.
**Related:** `web-architecture.md` §2 already maps `StateFlow` → the React Query cache. This doc is
literally that: adding an upstream publisher to a cache that today is only fed by your own mutations.

## 1. Short answer, with the reasons

| Question | Answer |
| --- | --- |
| Does the architecture survive it? | Yes. `createApp({ db, auth, bus })` is the same injection story as `db`/`auth`/`riot`; the invalidation mapping is a pure module, which is exactly what `web-architecture.md` asks for. |
| New dependencies? | None. `EventSource` is in the browser; streaming `Response` is in Bun. No socket.io, no Redis. |
| New infrastructure? | None — *while there is one API container*. That assumption is the thing to write down (§5.3), not the thing to hide. |
| Database change? | None. Not one migration. |
| Lines of code? | Order of 120–180 across 5 files + tests (§7). |
| What actually costs? | Every mutating route gains a second responsibility ("publish"), and forgetting it fails **silently** (§6). |
| What would make it expensive? | Sending data instead of hints, presence/typing/CRDT, per-widget streams (§9). |

Roughly: **a weekend for the SSE tier, an hour for the free tier below it** — and the free tier is
most of the perceived benefit.

## 2. "Reactive" is two different wishes

People say "reactive" for two things that need completely different machinery, and conflating them is
why this feature usually balloons:

1. **"My edit appears instantly."** Affects only me. This is an **optimistic update / local cache
   write** — no server involvement, no push, works offline. Cheap and it is what makes an app *feel*
   reactive.
2. **"Someone else's edit appears while I'm looking."** Needs a server push. The value is entirely in
   *how often two people are on the same screen at the same time*.

So before building (2), note that (1) is usually what is missing, and (1) is 10 lines per mutation.

### 2.1 Where wish (2) actually pays off for this product

Six people, mostly idle, with **one bursty moment: during a scrim**.

| Surface | Two people on it simultaneously? | Verdict |
| --- | --- | --- |
| Matchday page while recording games | **yes** — someone records, someone else watches/reads VODs, one is on the phone | the one real case |
| Team home page | yes, by definition — it is the page everyone leaves open | good, cheap (it is one query of hints) |
| Topics for the next meeting (§9 of `matchdays.md`… `team-home.md` §9) | rarely at the exact same second | nice, not needed |
| Availability answers | different days | nice, not needed |
| Roster / admin | captain alone | no |
| Bilanz, archive, match history | read-only, changes after the fact | no |

That table is the honest scope: **one page + one list**. Everything else is a poll away.

## 3. Tier 0 — the free 80 % (do this regardless)

Every item here works today, needs no server change, and costs minutes:

- **Turn `refetchOnWindowFocus` back on** (`apps/web/src/main.tsx:17` sets it to `false`). This one
  flag covers the most common real situation: I was in Discord/the draft tool, I come back, my data is
  from 20 minutes ago. It is the cheapest "reactive" there is.
- **Refetch on reconnect** (`online` event) and on `visibilitychange` → `visible`.
- **Optimistic updates** for the mutations that feel laggy (record a result, toggle a topic, set
  availability) — write the cache, roll back on error. Also `invalidateQueries` on success, which is
  already happening in a few places.
- **Poll while the tab is visible** for the one hot surface (matchday): `refetchInterval: 15_000` with
  `refetchIntervalInBackground: false`. Six people × a 15 s poll is 0.4 req/s for the whole server —
  invisible, and it covers the scrim burst completely.
- **Stale-while-revalidate copy**: show the old value with a subtle "updating" tick instead of a
  skeleton. Perceived reactivity is mostly about not flashing empty state.

If only the scrim page matters, **stop here and ship Tier 0.** The honest recommendation is to ship
Tier 0, use it for two weeks, and only then decide whether anyone actually noticed the 15 s delay.

## 4. Tier 1 — Server-Sent Events + an in-process bus

If the poll still feels wrong, this is the shape that stays cheap.

### 4.1 SSE, not WebSockets

| | SSE (`EventSource`) | WebSocket |
| --- | --- | --- |
| Direction needed | server → client only ✅ | bidirectional (we need none) |
| Transport | plain HTTP response, goes through the existing same-origin proxy | protocol upgrade, own upgrade handling in proxy/Caddy |
| Client code | `new EventSource(url)` — reconnect and `Last-Event-ID` built in | hand-rolled reconnect, ping/pong, backoff |
| Auth | **the existing cookie**, same origin, nothing new | cookie on the upgrade request, then a separate concern |
| Testability | read one chunk off a `Response` body in a `bun test` | needs a real socket |
| Cost | no client→server messages (we want none) | — |

We have exactly one direction of traffic. Choose the piece of infrastructure that only does that.
(`web-architecture.md`'s Compose analogy holds: it is a `StateFlow` fed from outside, not a
conversation.)

### 4.2 The rule that keeps it cheap: events are hints, not data

```text
event: change
data: {"kind":"match:games","teamId":"…"}

kind ∈ topics | match:games | match:meta | availability | roster | home
```

- **No rows, no diffs, no version numbers, no ordering guarantees.** The client turns a `kind` into
  query keys and refetches from Postgres, which is the only source of truth.
- Consequence: a dropped, duplicated or out-of-order event is a **stale screen until the next event or
  focus**, never corrupt state. That deletes ~80 % of the design work (resume tokens, sequence
  numbers, reconciliation, "did I miss one?").
- Consequence: the stream carries **no data worth leaking**, which makes the security story "can you
  subscribe to this team's kinds?" instead of "is every field in this payload authorised?".
- `kind` is a closed enum in `packages/shared` — the client mapping is a `Record<kind, QueryKey[]>`,
  so an unknown kind is ignored, not a crash (version skew between a cached SPA and a new API).

### 4.3 Server shape

```text
apps/api/src/realtime/bus.ts        createBus(): { publish(teamId, kind), subscribe(teamId, fn) }
                                    in-process Map<teamId, Set<fn>>, no deps
apps/api/src/routes/events.ts       GET /api/teams/:teamId/events  → text/event-stream
apps/api/src/app.ts                 createApp({ db, auth, bus })    ← injected, like db/auth
```

- Route publishes after a successful write: `publish(teamId, 'match:games')`. One event per *route*,
  never per row — importing 8 enemy players publishes once (§5.6).
- Existing route factories already take `(db, authPlugin)`; they gain `(db, authPlugin, bus)` — the
  same change shape as adding `riot` later, so nothing new to learn.
- The stream handler: `{ teamMember: true }` guard (the session is read once at connect, §5.1), then
  return a `Response` with a `ReadableStream` that writes `data:` lines and periodic `: ping`
  keepalives. Verify the current Elysia idiom (raw stream vs a helper) against the docs before
  implementing — this is the one place where the framework's API may have moved.
- **One stream per tab**, subscribed to the active team. Not one per query, not one per widget: HTTP/1.1
  allows ~6 connections per origin and a per-widget design burns them.
- Switching teams (multi-team) closes and reopens the stream. Two open tabs in two teams = two
  streams, which is fine.

### 4.4 Client shape

```text
apps/web/src/realtime-map.ts        kind → [query keys]     ← pure, unit tested
apps/web/src/useTeamEvents.ts       EventSource lifecycle, reconnect policy, on 401 stop
apps/web/src/main.tsx               <TeamEventsProvider/> inside QueryClientProvider
```

- The hook only calls `queryClient.invalidateQueries({ queryKey })` — the cache remains the single
  place the UI reads from, exactly as today.
- With multi-team, query keys must gain the `teamId` (`['players', teamId]`). Today they are flat
  (`['players']`), which is fine for one team and becomes a cross-team cache bug the moment membership
  exists — an event for team B would invalidate team A's key. Fix the keys with that change, not later.

## 5. The parts that are not free (the actual risk list)

### 5.1 Auth on a long-lived request

The connection is authorised **once, at connect** — and then lives for hours. So:

- Authorise with the normal session cookie at connect time; if the session is missing/pending → 401.
- **Re-check periodically** (on each keepalive, cheap: one indexed session read every 30–60 s) or the
  connection outlives a revoked session, a disabled member, or a *kick from the team*. A member
  removed from a team must stop receiving that team's events **without** a page reload.
- On session change/logout, close the stream server-side and client-side. Otherwise a logged-out tab
  keeps a live feed into a team's activity.
- **Exactly the tenant-leak risk of `multi-team.md` §5**, one layer nastier: a wrong `WHERE` leaks one
  response; a wrong subscription leaks a continuous feed. Scoping is by `teamId` **on the server**
  (the bus subscription), never by filtering in the client.

### 5.2 `EventSource` retries forever on 401

Spec behaviour: on any error the browser retries. A 401 therefore becomes an **infinite reconnect
loop** against a rate-limited login endpoint, on every open tab. Handle it explicitly:

- on `error`, stop and check `/api/me`; if `401`, close and show "logged out" instead of retrying;
- otherwise exponential-ish backoff via `retry:` + a manual close/reopen, capped;
- and since a phone in a pocket drops the connection constantly anyway, **Tier 0's focus refetch must
  stay** — the stream is an optimisation, not the mechanism.

### 5.3 One process, or the events silently stop

An in-process `Map` only reaches subscribers in the same process. Today `docker-compose.yml` runs a
single `app` container, so it works. The failure mode when that changes (two replicas, a rolling
deploy) is the bad kind: **no error, no log, just a UI that stops updating** — and it will be blamed
on the browser.

Three honest options:

| Option | Cost | Note |
| --- | --- | --- |
| Document the constraint ("SSE requires a single API replica") | 0 | fine while it is true; violates the moment someone scales |
| `postgres LISTEN/NOTIFY` for the bus | one extra long-lived connection | no new infra, works across replicas; payload must be a *hint* (§4.2), never data — 8 KB limit and no delivery guarantee |
| Redis pub/sub | one more container | real infrastructure for a six-person app; not worth it |

Recommendation: **`LISTEN/NOTIFY` from day one if it is less than ~30 lines** (it removes the only
silent failure), otherwise in-process + a loud comment in `bus.ts` and in the deploy docs. Either way,
the hint-not-data rule means *Postgres is still the source of truth* — a missed notification is a
stale screen, not a lost write.

### 5.4 Proxies and buffering

`text/event-stream` gets buffered by middleboxes, and buffered SSE looks exactly like a broken feature
(events arrive in bursts, or after 30 s). `docker-compose.yml` already mentions putting nginx/Caddy in
front. So:

- send `Cache-Control: no-cache`, `Connection: keep-alive`, and `X-Accel-Buffering: no` (nginx);
- verify the dev path too: Vite's `/api` proxy → `http://localhost:3001` must not buffer;
- test it through the **real** proxy at least once, not only against `localhost:3001`.

### 5.5 React `StrictMode` double-mounts

Dev mode mounts effects twice → two `EventSource`s, two subscriptions, duplicated events. Only visible
as "why does my dev server show 2 connections", which is why it gets shipped. The hook's cleanup must
`close()`; make that a test-visible concern (fake `EventSource` in a web unit test) rather than
something noticed by luck.

### 5.6 Bursts and coalescing

A captain importing a multisearch URL touches ~8 enemy rows in one request — one publish, not eight
(§4.3). If a route ever loops over writes, publish once at the end. If a future bulk action publishes
N events, the client should coalesce: a 100–200 ms debounce per `kind` in the provider turns a burst
into one refetch.

## 6. The real recurring cost: the discipline tax

Every mutating route now has an obligation: **remember to publish**. Forgetting it is invisible —
tests pass, the API is correct, and one page is quietly stale. This is the *same class* of problem
`multi-team.md` §5 already flagged for `WHERE teamId = ?`, and it deserves the same answer:

| Approach | Strength | Cost |
| --- | --- | --- |
| Publish inside each route handler | none once someone is tired | 0 |
| Publish inside the route factory's shared write helper (`mutate(kind, fn)`) | structural: the write and the publish cannot be separated | small |
| **DB trigger → `pg_notify`** | unforgettable — the database cannot skip it | a migration per table + the `table → kind` map now exists in SQL *and* TS |

Recommendation: shared write helper now; revisit only if a stale page actually happens. The DB-trigger
version is tempting precisely because it kills the silent failure, but it duplicates the `kind`
vocabulary in SQL — two places that must agree is the thing this codebase keeps trying to avoid
(`quick-wins.md` B2 is the same lesson with `ROLES`).

Optional cheap guard: one table-driven test that every mutating route in `app.routes` publishes — it is
introspection, not behaviour, so it degrades gracefully as routes are added.

## 7. Testing (per `AGENTS.md`)

The feature splits cleanly along the existing policy, which is why it is cheap to prove:

**Unit, no infra** (the web side already has `happy-dom` + `apps/web/test/setup.ts`, so the hook test
needs no new harness):

- `bus.ts` — `publish` reaches only subscribers of that `teamId`; unsubscribe stops delivery; publish
  with no subscribers is a no-op, not a throw.
- `realtime-map.ts` (web) — `kind → query keys`, unknown kind → ignored, one event → all keys for that
  kind.
- `useTeamEvents` reconnect policy with a fake `EventSource`: 401 → close (no retry loop), network
  error → retry, cleanup → `close()` (§5.2, §5.5).

**Integration, throwaway DB** (`createApp(...).handle(request)`, already the harness):

- `GET /api/teams/:id/events` without a session → 401; as a member of another team → 403/404.
- Connect as a member, `POST` a game result, **read one chunk of the response body** and assert it is
  a well-formed `data: {"kind":"match:games",…}` frame. This is the test that proves the whole
  pipeline in-process, with no port and no browser.
- **Tenant isolation on the stream**: subscriber of team A, publish for team B → nothing arrives
  within the read timeout. This is the §5.1 test and the one that must exist before the feature ships.

**Not tested this way:** browser `EventSource` semantics, proxy buffering (§5.4) — those need a real
browser/proxy and belong to a manual smoke check, stated as such.

## 8. Cost, honestly

| Piece | Files | Effort |
| --- | --- | --- |
| Tier 0 (focus/online/poll/optimistic) | `main.tsx`, 2–3 hooks | ~1 hour |
| Bus + `/events` route + injection | 3 files | hours |
| Client hook + map + provider | 3 files | hours |
| Publish calls in existing routes | 1 line each | minutes |
| Tests | 3–4 files | the other half of the work |
| Migrations | **0** | — |

The line count is small. The *attention* cost is the discipline tax (§6) plus the four browser/platform
traps (§5.2, §5.4, §5.5, mobile sleep), which is where the days actually go.

## 9. What would make it expensive — do not do these

- **Sending rows in events** ("here is the new matchday"). Now you need ordering, dedupe, schema
  versioning, and per-field authorisation on every payload. Refetch instead.
- **Presence / typing indicators / live cursors.** A second protocol's worth of state with an
  expiry model, and it degrades to nonsense the moment someone's laptop sleeps.
- **Collaborative editing of the same note** (CRDT / OT). If that is ever wanted, embed an editor — do
  not build it.
- **A stream per widget** (topics stream, games stream, roster stream). Connection limits (§4.3), N×
  auth checks, N× reconnect logic, for zero extra freshness.
- **Push notifications** (phone buzzes when a scrim is set). That is Web Push + VAPID + a service
  worker + a subscription table — genuinely separate feature, and not what "reactive UI" means.
- **`socket.io`** for any of the above. It solves problems (rooms, fallbacks, binary) that this app
  does not have, at the price of a dependency and its own auth story.

## 10. Recommendation, in order

1. **Tier 0 now** — including turning `refetchOnWindowFocus` back on. One hour, no server change, and
   it is what "feels reactive" to a user.
2. **Tier 1 only for `match:games` + `home`** if the 15 s poll is visibly annoying during a scrim.
   Everything else keeps polling or focus refetch.
3. **Use `LISTEN/NOTIFY`** for the bus if it stays under ~30 lines — it is the difference between "one
   replica or silence" and "just works".
4. **Never** Tier 2 (§9) unless something here hurts for a reason this doc did not predict.

## 11. Open questions

1. **Does the scrim page actually need < 15 s freshness**, or is a poll enough? Answer that before
   writing `bus.ts` — it decides whether this feature exists at all.
2. **`LISTEN/NOTIFY` vs in-process bus**: is the single-replica assumption something to protect now,
   or accept with a comment? (The deployment is one container today.)
3. **Which events are "hints" for a *whole* team vs a *person*?** A membership change affects one
   person's visibility (their teams, their role). Do we need a user-scoped stream, or is closing their
   connection on a role change enough?
4. **Do we ever want a "someone changed this while you were typing" guard** on forms (notes, results)?
   That is optimistic-concurrency (send `updatedAt`, get 409) — cheaper than realtime and independent
   of it. Probably yes for notes, no for checkboxes.
5. **Keepalive interval** — 15 s? 30 s? Sets mobile battery cost and how fast a dead connection is
   noticed.
