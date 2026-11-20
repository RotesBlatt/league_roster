# Idea — match history + champion stats (automated, per team)

**Status:** idea, nothing implemented.
**Depends on:** `multi-team.md` (everything is team-scoped) and `player-profiles.md`
(`riot_account` with a required `platform` and a stable `puuid` — the whole feature hangs off it).
**Companion, later:** the *champion pool* idea (pool vs. "sonst gespielt", the "WR-Basis" filter).
This doc deliberately stops at "champion grouped by games"; it must not presuppose pools.

## 1. The idea

Every hour the server pulls the games of **every League account that belongs to a member of the
team**, and the team gets two views on top of that data:

1. **Games** — one row per (game, our participant): date, type (Flex / SoloQ / Tournament), player,
   their role and lane, their champion, their lane partner, their lane opponent and that opponent's
   partner, W/L, KDA, how many of ours were in that game, the account, and a **manual note**.
2. **Champion stats** — champions grouped per player, each with games, W/L, win ratio and *when it
   was last played*. Filterable/sortable so a Flex game, a SoloQ game and a tournament game are
   different data sets.

Both views come from the same rows; only the grouping differs. Two sources and one extra relation feed
those rows:

1. **Riot** (`match-v5`) — ranked, normal and custom games played on live servers. Downloaded (§4).
2. **Riot's tournament API** (`tournament-v5`) — the *same base URL, the same key, the same rate
   limit*, a different path: games played on a **tournament code** are fetched by code (§4.7, §6),
   which gives an exact join to a match instead of a guess.
3. **People** — scrims are played where neither path can see them, so a match can be entered by hand
   (§5.8), and any game can carry a manual note (§5.5).

What makes a game a *tournament* game is not a fourth source: it is a membership row produced by the
tournament path (`tournament_game`, §4.7) pointing at a match that is otherwise a normal Riot row.

Champion names, icons and other per-champion info come from **Hexserve**, the team's own patch dump —
its own idea, `hexserve-champion-data.md` (§5.7 here is only the pointer).

### What the screenshots pin down

The two attached sheets are the *intent*, not a spec, but they settle a lot:

| Observed | Consequence for the design |
| --- | --- |
| `GAMES` repeats "09.11.2026 Flex" five times with 5 different players | the list is **per participant**, not per game. One game = up to 5 rows. Grouping by game is a UI concern (§9) |
| a `Team` column showing `3/5` | "how many of ours played" is wanted — and it has to be *derived*, never stored |
| `Partner`, `Lane-Gegner`, `Gegner-Partner` | the bot lane needs three extra names, not one. See §7 — this is a heuristic, not an API field |
| `Account` next to `Spieler` | one member, several accounts, all merged under the person but attributable per game |
| `Notiz (manuell)` | a human field lives next to synced fields → the sync must never write over it (§5.5) |
| `CHAMPION-STATS` columns: Champion, Games, W/L, WR, Zuletzt | exactly the four numbers wanted; empty rows render `–`, not `0%` |
| per-player header "15 Games (nur Pool) · 60% Winrate" | the aggregate is per player *and* per filter scope |
| `TYP` ("Alle") and `WR-BASIS` ("Nur Pool-Champs") selectors | filtering is a first-class, shared concern, not a per-view hack |
| WR colours: 100/56 green, 50 amber, 40/17 red, 0 games grey | one pure function decides the tone (§8) |

Two things in the sheet are visibly mis-filled (row 1 of `GAMES` lists a top-laner with the bottom
lane's opponent pair). So: keep the **column set**, derive the **values** per participant rather than
copying how the old sheet happened to fill them.

## 2. What is genuinely new here

Nothing in the app touches time-based background work today. There is no scheduler, no worker, no
job table, no rate limiter, and the only injected dependables are `db`, `auth` (and later `riot`).
This feature adds **the first periodic process in the codebase**, and that — not the champion
grouping — is where the risk is.

## 3. The four hard parts

1. **The refresh loop** — hourly, per account, idempotent, inside a rate budget that is much smaller
   than it looks, with no scheduler to lean on (§4).
2. **Deduplication across accounts** — five members of one team in one Flex game means five accounts
   saw the same match. Handled naively that is one game fetched five times and stored five times
   (§4.4, §5.2).
3. **The derivations that look free and are not** — lane partner, lane opponent, remakes, "how many of
   ours" (§7), and the fact that "tournament" simply is not in Riot's payload (§6).
4. **A second writer into the fact table** — a hand-entered scrim (§5.8) has no Riot id, no ten
   participants and no KDA, yet it must sit in the same table, count in the same champion stats and
   survive every sync untouched. And it must not be confused with the games Riot *does* report: the
   same scrim block is half on tournament codes and half invisible (§4.7).

## 4. The hourly refresh

### 4.1 Where the loop runs

No new service. One repeating job inside the API process, guarded so it runs **once** even if there
are ever two instances:

```text
setInterval(tick, 60_000)                      // wake up every minute
  if (!await pg_try_advisory_lock(JOB_MATCH_SYNC)) return   // someone else has it
  due = accounts whose lastAttemptAt is older than the refresh interval
  for each due account: syncAccount(account)   // rate-limited, chunked, resumable
```

- **Advisory lock, not a `isRunning` boolean**: a boolean in memory dies with the process and lies
  across instances. `pg_try_advisory_lock` is released by Postgres when the connection drops, so a
  crash cannot wedge the job.
- **"Due" is state, not a timer per account.** One job walking a table of due accounts survives a
  deploy mid-cycle; `setTimeout` per account does not.
- The interval is a config value (`MATCH_SYNC_MINUTES`, default 60) — hourly is the product
  decision, not a constant to bury.

### 4.2 The rate budget is the design constraint

Riot's development key allows **20 req/s but only 100 req/2 min**, and **expires every 24 hours**
(verified against the portal/docs, but re-verify before implementing — the dev tier is not a
contract). The binding number is not 20/s, it is **~0.83 req/s sustained**.

An account sync is `1 list call + 1 detail call per **new** match` — new to the whole database, not
new to that account (§4.4). Five of ours in one Flex game is 5 list calls and **1** detail call. So
per hour a 10-account team costs roughly `10 list + (distinct new games that hour) detail`:

| Work | Requests | Time at 0.83 req/s |
| --- | --- | --- |
| hourly incremental, 10 accounts, playing together | ~15–20 | < 30 s |
| hourly incremental, 10 accounts, all in separate games | ~35 | ~1 min |
| optionally loading ~100 games of history for one account (§4.5) | ~101 | ~2 min |

The difference between the first two rows is the argument for looking each match up once (§4.4): the
detail call, not the list call, is what costs.

Consequences, all of them requirements rather than niceties:

- **One global token bucket**, not per-account sleeps. Otherwise 10 accounts each politely waiting
  still burst 10× over the limit together.
- **Nothing unbounded is ever queued.** The core loop only ever fetches what is genuinely new; the
  one thing that could eat the budget is optional history loading, which is capped for exactly that
  reason (§4.5).
- **Production key = a decision, not an implementation detail**: an app used by real people needs
  the production tier or it re-breaks every morning at the 24h expiry. See §10.1.
- 429 → stop the cycle, honour `Retry-After`, record `lastError`, do not count it as an account
  failure. 403/timeout → the same "degrade, never block" rule as `player-profiles.md` §4.

### 4.3 What "incremental" means concretely

`GET /lol/match/v5/matches/by-puuid/{puuid}/ids` (regional host, e.g. `europe`), params
`start`, `count` (max 100), `startTime`, `endTime`, `queue`, `type`. Newest first.

```text
cursor = newest gameStartAt already stored for this account   (nullable)
page   = by-puuid/ids?startTime=cursor - margin&count=100
stop when: a matchId we already have appears, OR page < count, OR pageCap reached
```

- **Stop on a known matchId, not only on `startTime`.** Timestamps from the API and our stored rows
  can differ by seconds; a time-only boundary silently drops or re-fetches games forever.
- `startTime` is a **cheap pre-filter** (subtract a margin, e.g. 1h) to keep pages small — the
  known-id check is what makes the loop *terminate correctly*.
- **`queue` filter is not trustworthy** for our purposes: there are reports of `queue=420` returning
  nothing for games that exist. Fetch unfiltered and classify locally (§6).
- Cap pages per account per tick (`MAX_PAGES`) so one pathological account cannot starve the rest.
- A listed matchId whose detail call 404s (Riot has transient gaps, and very old games can be pruned)
  must be **recorded as skipped**, not logged — otherwise every hourly cycle retries it forever.
  One row (`match_skip`, §5), because the retry *is* the bug.

### 4.4 Idempotency

The loop reduces to one rule: **a match is looked up once and stored once — per match, not per
account.**

```text
for each new matchId coming out of the list pages:
    if (await matchExists(matchId)) continue      // ← this is why the budget fits
    detail = riot.getMatch(matchId)
    insert match + its ten participants
```

`match` is keyed by Riot's `matchId` (`EUW1_1234567890`), `match_participant` by `(matchId, puuid)`,
both inserted with `ON CONFLICT DO NOTHING`. Two properties fall out:

- **safe to run twice**, after a crash, or for two accounts that played the same game — the check is
  an optimization, the conflict clause is the guarantee;
- **the check-then-fetch race is benign**: two accounts syncing in parallel can both miss the row and
  both fetch (one wasted request; `DO NOTHING` absorbs the second insert). Do not reach for a lock
  per matchId — the loss is one request, the lock would cost more than it saves.

The existence check is a primary-key probe, so it is free, and skipping the detail call for a match we
already hold is worth more than every other rate-limit trick in this document combined (§4.2).

### 4.5 History loading — optional, capped, not part of the core loop

A newly added account starts empty and simply accumulates **from now on**. That is the default and it
is sufficient: nothing in §5–§9 depends on history, and the hourly loop fills the views from the
first cycle onward.

If someone wants the past, it is an explicit opt-in per account with a hard cap
(`BACKFILL_MAX_GAMES`, ~100) and a fixed depth (last N games **or** last 90 days, whichever is
smaller). Same token bucket, chunked and resumable so a deploy cannot lose its place, and a partial
marker while it runs. Once the cap is reached it never runs again — a one-time convenience, not a
sync mode.

It stays this small on purpose: the feature is complete without it, deferring it costs nothing, and
the engineering that matters — fetch once, derive the rest, one sync path — is identical either way.
The honest consequence to put in the UI copy: a player added today has less history than one added
a year ago, and that is a fact, not a bug.

### 4.6 The manual refresh button (with a cooldown)

Hourly is the floor, not the ceiling: after a game someone wants it *now*. So the Games view gets a
**Jetzt aktualisieren** button. It is a request to run the same sync, now, for this team's accounts —
not a second code path, and not a per-account fetch the loop doesn't know about.

```text
POST /api/teams/:slug/matches/refresh   guard: { member }
  state = manualRefreshState(refresh.lastManualRefreshAt, now, COOLDOWN_MIN)
  if (!state.allowed) → 429 { retryAfterSeconds }        // no Riot request is made
  if (!canGrab("match-sync:" + teamId)) → 200 { started: false, reason: "running" }
  run the incremental sync for this team's accounts, bounded (below)
  record lastManualRefreshAt + outcome  — ON ATTEMPT, not on success
  → 200 { syncedAt, newMatches, partial: boolean }
```

Decisions that matter, each with its reason:

- **Cooldown is per team, not per user or per account.** The thing being protected is one shared
  rate budget and one shared dataset; five members clicking in turn must not buy five refreshes. The
  state is one row (`match_refresh`, §5), so it also survives a deploy — a `lastClick` in memory
  would hand everyone a fresh reset exactly when the server restarts.
- **Cooldown is spent on attempt, not on success.** Otherwise a failing cycle (Riot 429, timeout) is
  a free repeated click, and the retry storm is the one case where the button does real damage.
- **Server-enforced; the disabled button is only a hint.** The UI disables it and counts down, but
  the rule lives in the route, and in `manualRefreshState(lastAt, now, cooldown)` — a pure function in
  `packages/shared`, unit-tested at the boundary (exactly at the cooldown, no prior refresh, clock
  slightly behind). Same shape as every other rule in this codebase.
- **It shares the global token bucket** (§4.2), so a click can never starve the hourly loop; if the
  bucket is dry the click returns "in ~40 s" from the limiter instead of pretending to work.
- **It never triggers history loading.** The button means "catch me up on the last hour", not
  "download six months". The optional backfill keeps its own capped path (§4.5), otherwise one
  impatient click parks the API budget for twenty minutes.
- **Bounded, and honest about being partial.** Cap the work (~20 requests or ~10 s); if the cap is
  hit, say so (`partial: true`) rather than block an HTTP request for a minute. The client refetches
  the lists once on completion — no SSE needed (still on the "not built yet" list).

What it costs, so `COOLDOWN_MIN` is a number and not a vibe: one click ≈ `N accounts` list calls +
1 detail call per genuinely new game. For 10 accounts that is ~10–15 requests ≈ 15 s of budget. A
5-minute cooldown allows 12 clicks/hour ≈ 180 requests; 10 minutes allows 6 ≈ 90. Since the hourly
cycle already covers the normal case, **default 10 min** and make it configurable.

Cooldown length and "who may click" are §10.11.

### 4.7 Tournament games: the same Riot API, a different path (`tournament-v5`)

Correction to the obvious guess: tournaments are **not** a separate provider or host. It is the same
base URL, the same API key and the same rate limiter as `account-v1` and `match-v5` — only the path
is different, and the routing family is the **platform** one (`euw1`), the same as summoner-v4, not
the regional one (`europe`) that serves `by-puuid` lists.

The relevant routes:

| Route | Use |
| --- | --- |
| `POST /lol/tournament/v5/providers` | register a provider per region — **once**, a prerequisite |
| `POST /lol/tournament/v5/tournaments` | create a tournament under that provider |
| `POST /lol/tournament/v5/codes` | mint N codes for a tournament (summoner allow-list, pick type, map) |
| `GET` / `PUT /lol/tournament/v5/codes/{code}` | read / change one code |
| `GET /lol/tournament/v5/games/by-code/{code}` | **the game ids played on that code** — this is our join |
| `GET /lol/tournament/v5/lobby-events/by-code/{code}` | who joined the lobby, when — usable before the match exists |

### What that changes, and what it fixes

- **No second client, no second source.** `RiotClient` grows `getGamesByCode(code)` and
  `getLobbyEventsByCode(code)`; `createApp({ db, auth, riot, hexserve })` stays as it was. A
  tournament game is a **Riot match row** like any other — full participants, KDA, the lot. Only its
  *membership* is extra.
- **The join is exact, not a heuristic.** `games/by-code/{code}` returns numeric game ids, and Riot's
  `matchId` is `{PLATFORM}_{gameId}` (`EUW1_7123456789`) — so the match row is looked up directly.
  Compare the alternative from the earlier draft ("match by timestamp + roster"): that is exactly the
  guess this removes.
- **Same token bucket.** That reverses the earlier assumption of an independent budget: these calls
  are cheap (one per known code per cycle, not one per account) but they **do** compete with the
  hourly loop, so they go through the same limiter and cannot burst past it.
- **Tournament codes must be stored**, because the code is the only way back to the games:
  `tournament` (provider, Riot tournament id, our name for it, region, **kind**) and `tournament_code`
  (the code itself, which tournament, platform). A captain either mints codes here or types in the
  codes a league gave them.
- **Membership is a fact, the label is a decision.** `tournament_game (tournamentId, matchId)` comes
  from the API, so `kind = 'tournament'` is no longer a human guess (§6). But a code we mint for a
  *scrim block* must not show up as a tournament game — which is why the `tournament` row carries its
  own `kind` (`tournament` | `scrim` | `practice`), set once by a human, inherited by every game on
  its codes.
- **The production key goes from "nice" to "required"** for this scope: the tournament endpoints are
  not available to a development key, and provider registration is an approval step (§10.1, §10.12).
  The champion table does not depend on it (§12 step 5), which is why that step comes first.
- **What it does *not* cover:** only games played on codes our provider can query. A Prime League
  match played on the organiser's codes is visible **only if** those codes are queryable with our key
  — verify that before promising the tournament tab (§10.12). The fallback is unchanged: a captain
  enters the game by hand (§5.8) and tags it `tournament`.
- **Degrade, never block** (`player-profiles.md` §4): no provider, expired key or 403 → the tournament
  scope shows what is already stored, the games list keeps working, one log line, no user-facing
  error beyond a "Turnierdaten fehlen" hint.

## 5. Data model

### The rule: everything is stored once, or not at all

A match is looked up once (§4.4) and exactly one row describes it. Every further column has to
answer one question — *is this a fact I cannot get back, a human decision, or arithmetic?* Only the
first two get a column.

| Bucket | Examples | Where it lives | Why |
| --- | --- | --- | --- |
| **Riot fact** — immutable, and obtaining it costs a rate-limited request | `queueId`, `gameStartAt`, `durationSeconds`, `gameVersion`, `platformId`, the ten `puuid`s, `side`, `teamPosition`, `championId`, K/D/A, CS, gold, vision, `win` | `match` + `match_participant` | re-deriving means re-fetching, and Riot is the only source |
| **Membership fact** — from the tournament API | which match was played on which tournament code, and under which tournament (and its kind) | `tournament`, `tournament_code`, `tournament_game` | the code → game id relation exists only in Riot's data; it cannot be reconstructed from the match rows |
| **External fact** — from a person | a hand-entered scrim's champions, W/L, opponent names, and any round/series label nobody else provides | `match` / `match_participant` with `source = 'manual'` | not derivable from Riot data at all — no amount of local computation produces "we lost that series 1–2" |
| **Derivation** — a pure function of stored facts | remake (`duration < 300s`), `kind` (`classifyQueue`), `teamCount`, `partner` / `laneOpponent` / `opponentPartner`, champion `games`, `W/L`, `winrate`, `lastPlayedAt`, every champion name and icon, every player display name | **no column** — computed on read (§8) | one source of truth; a stored derivation can silently disagree with the rows it came from |
| **Human decision** — not derivable, must survive every sync | `note`, `taggedKind` (a captain re-tagging a custom game as a tournament game) | `match_annotation`, a table the sync's write path never reaches (§5.5) | §5.5 |
| **Process state** — ours, not Riot's | cursors (`account_sync`), the skip list for ids that never resolve (`match_skip`), the manual-refresh cooldown (`match_refresh`) | their own small tables | it is what makes an hourly loop resumable, non-repeating and rate-limit-safe; none of it is derivable from matches |
| **Cache** — a derivation stored for speed | the patch-keyed `champion` table (`hexserve-champion-data.md` §4); a per-champion aggregate; a materialized `teamCount` | `champion` only, and it is that doc's table | allowed **only** with a named invalidation trigger and a test proving it can go stale. The `champion` cache's trigger is "a new version appears in `version.json`"; the other two have no trigger, so they get no table |

Inference is cheap enough to be the default because the data is local and small: a team-season is
~2 000 matches and ~20 000 participant rows, and the group-by is the *same* query whether one player
or all five ask. Pagination and the scope filter still happen in SQL (`gameStartAt` index, `queueId`
index), driven by one shared scope→queueId set in `packages/shared`, so the SQL filter and the TS
label cannot disagree — `quick-wins.md` B2 is what happens when they do.

```text
riot_account        id, userId, puuid (UNIQUE, required), platform, gameName, tagLine, …
                    + from player-profiles.md; puuid is the identity, the name is only a label
                    archivedAt (nullable)            ← soft delete, §5.6

champion            patch + championId → name/icon/positions/roles
                                                 ← NOT ours: `hexserve-champion-data.md` §4. Referenced
                                                   here only because the games list renders from it.

tournament          id (PK), providerId, riotTournamentId, name, region, platformId,
                    kind ('tournament' | 'scrim' | 'practice'),   ← the label, decided once
                    createdBy, createdAt

tournament_code     code (PK, Riot's string), tournamentId → tournament, platformId,
                    lastCheckedAt, lastGameId (nullable)         ← the only way back to games (§4.7)

tournament_game     tournamentId → tournament, matchId → match, tournamentCode
                    PK (tournamentId, matchId)                   ← FACT from games/by-code

match               id (ours, PK)                 ← a manual row has no Riot id
                    source ('riot' | 'manual'),
                    riotMatchId (UNIQUE, nullable),
                    platformId, gameStartAt (timestamptz), gameEndAt, durationSeconds,
                    queueId, gameType, gameVersion,      ← nullable: a manual row has none of these
                    createdByTeamId, createdBy (nullable) ← who typed it in (§5.8)
                    fetchedAt
                    INDEX (gameStartAt), INDEX (queueId), INDEX (source)

match_participant   id (PK), matchId → match, side (100|200),
                    slot (Riot's participantId 1-10), puuid (nullable),
                    teamPosition (nullable), championId (nullable), win (nullable),
                    kills, deaths, assists, cs, goldEarned, visionScore
                                                 ← nullable on purpose: a hand-entered scrim has
                                                   "who + champion + won?" and nothing else
                    UNIQUE (matchId, side, slot)
                    UNIQUE (matchId, puuid) WHERE puuid IS NOT NULL
                    INDEX (puuid), INDEX (championId)

match_annotation    matchId → match, teamId → team,
                    note, taggedKind (nullable), updatedBy, updatedAt
                    PK (matchId, teamId)             ← HUMAN; no sync code path reaches this table

match_skip          matchId (PK), reason, attempts, lastAttemptAt
                                                 ← a listed id that never resolves (§4.3)

match_refresh       teamId (PK) → team, lastManualRefreshAt, lastManualRefreshBy,
                    lastOutcome                    ← the cooldown, per team (§4.6)

account_sync        riotAccountId (PK) → riot_account,
                    lastAttemptAt, lastSuccessAt, newestMatchStartAt (cursor),
                    backfilledThrough (nullable), backfillRemaining,   ← only if §4.5 is built
                    consecutiveFailures, lastError
```

Deliberately absent from that sketch, and each for a reason: `isRemake`, `kind`, `championName`,
`summonerName`, `teamCount`, and `note` on `match`. Arithmetic or human — the two buckets that do
not get columns on the fact tables. A manual match's kind is a human decision too, so it lands in
`match_annotation.taggedKind` like any re-tag: **one place answers "what kind of game was this?",
whoever answered.**

### 5.1 Store all ten participants, not just ours

It feels wasteful and it is the single most valuable storage decision here:

- the lane-opponent / partner columns (§7) come from the *other* nine participants — a
  participant-only store would need a **second Riot request per game** to render them;
- "how many of ours were in this game" becomes a self-join, not a stored count;
- future questions (damage share, gold diff at 15) need the opponent too.

Volume is a non-issue: 10 accounts × ~6 games/day ≈ 60 games ≈ 600 participant rows/day.

For Riot rows, all ten are always known, so nothing here is optional. For a manual row (§5.8) the
same table holds only what was typed — that is the whole reason `puuid`, `championId` and every stat
column are nullable (§5), and why `UNIQUE (matchId, puuid) WHERE puuid IS NOT NULL` is partial: an
unknown opponent is a row with a `slot` and nothing else, not a row with a fake puuid.

### 5.2 Deduplication: one game is one game

The five-rows-per-game sheet is fine as a *view*. As *storage* it is wrong. The team's five accounts
all "have" the same Flex game, so a naive per-account import creates the game five times with five
different local ids, and every statistic downstream double-counts.

The rule, stated as invariants:

- one `match` row **and one detail fetch** per Riot `matchId`, regardless of how many of our accounts
  were in it — the second account to see the game reads our row, it does not ask Riot again (§4.4);
- one `match_participant` row per `(matchId, puuid)`;
- "our rows" is a **join** `match_participant ⋈ riot_account`, never a flag set at import time. A
  player leaving the team then doesn't rewrite history, and a new account retroactively matches
  games already in the DB (worth knowing: they will show up without a refetch).

**Tenancy exemption — say it once, loudly:** `match` and `match_participant` carry **no `teamId`**.
A game belongs to Riot, not to a tenant; which team may see it is decided by the join, at query time.
Two consequences, both requirements: every read must start **from the team's accounts** (never
`FROM match`), and anything human about a match is per team — hence `match_annotation`'s
`PK (matchId, teamId)`. This is the one place `multi-team.md`'s "every table has a teamId" does not
apply, and it pays for itself: a game already stored is never fetched again, for anyone.

The invariant holds across both doors: **one row per game** — `UNIQUE (riotMatchId)` for anything Riot
reports (including tournament games, which arrive the same way), `source = 'manual'` for the only kind
allowed to carry no Riot id. Linking a manual row to a Riot match later is a human action (§5.8), and
**no sync ever updates a row whose `source` is not its own** — that one filter is what makes two
writers safe in one table.

Also: the same person on two of their own accounts in one game, or two of our players on
*opposing* teams (soloq, or a customs game where we split) — both are legal, both fall out of the
join, and neither has a special case. Only `tournament`/`custom` games with mixed rosters will make
this visible.

### 5.3 Time is an instant here

Unlike `availability-planner.md` (wall clock, minutes from midnight), a match happened at one moment
in history: store `timestamptz` in UTC, render in the team's timezone. Same team timezone field, two
opposite storage decisions for two genuinely different kinds of time. Say it out loud in the schema
comment or the next reader will "fix" one of them.

### 5.4 Champion identity

- **numeric `championId` is the key.** Names change, ids don't.
- **the name is not stored on the match.** It is a lookup in the patch-keyed champion cache
  (`hexserve-champion-data.md`): a rename shows the new name for an old game, while a patch-pinned icon
  still shows what the client actually looked like that week.
- `teamPosition` is a Riot string (`TOP`/`JUNGLE`/`MIDDLE`/`BOTTOM`/`UTILITY`, empty for non-SR).
  Map it to our `ROLES` in **one** pure function — `quick-wins.md` B2 is the cautionary tale about
  a mapping written twice.

### 5.5 Manual fields must be structurally unwritable by the sync

Human data lives in `match_annotation` — a table the sync's write path does not even reach. The
safest manual field is one the background job cannot name, and "one row type away" beats "every
future upsert must remember to exclude this column", hourly, forever.

Why not a nullable column on `match`: it would rest on a discipline ("never upsert this one") that a
later `...spread` in an upsert breaks silently. That is not hypothetical — `players.ts` already had
exactly this bug ("stop PATCH writing fields never sent").

Still test it: set a note and a `taggedKind`, run the sync twice over a window containing that match,
assert both survive and that re-fetching the match does not re-create the annotation.

### 5.6 What inference costs: never delete the referent

Deriving means a row is only as good as its joins — `match_participant.puuid → riot_account` is what
makes a game say *who* played it, and `riot_account.userId → user` is what makes it say *which
member*. So:

- **`riot_account` is archived (`archivedAt`), never deleted.** Removing an account from the app must
  not orphan 300 games into "unknown player"; the row stays, the join keeps working, the profile page
  hides it.
- **a member leaving the team keeps their accounts.** Their games still render, attributed to the
  person, marked as no longer on the roster — a departure does not rewrite history (§5.2).
- **a puuid without a `riot_account` row is not an error.** It happens; render champion and KDA, show
  the player as unknown, do not drop the row.

This is the honest trade for storing no name snapshots: the price of deriving a value is that you
have to keep the thing you derive it from. Two copied name columns would buy independence from that
join and cost a permanent "which of these two names is right?" question. Take the join.

### 5.7 Champion names and icons — a reference, not a section

This doc used to spell out the champion/patch data source. It is its own idea now:
**`hexserve-champion-data.md`** (the team's own dump, the `champion` cache — **current patch plus the
previous one, one label per champion id** — the retention/refresh rules, and how to degrade when the
dump is down).

All this doc needs from it is the **consumer contract**, which is one sentence: *we store
`championId`, we render name and icon.* So a participant's `championId` → one row in that cache, at
render time. Labels always come from the newest retained patch, so `match.gameVersion` stays a *label*
("gespielt auf 16.21") and never selects a label itself; nothing here gets a `championName` column
(§5 bucket table), and the `champion` cache row in the sketch below belongs to that doc, not this one.

Two consequences that are ours to keep:

- **an unknown `championId` is not an error** — a patch the dump has not ingested yet renders as an id
  and keeps every row that references it (§6);
- **a match must never fail to render because a label is missing** — the games list is data, the icon is
  decoration.

### 5.8 Manual matches — the data Riot will not give you

Scrims are real games that matter for scouting and they are **not downloadable**: they are played
where match-v5 cannot see them. So the fact table accepts a second writer, and the honest word for
it is *partial* — a hand-entered match has no Riot id, no ten participants, no CS, no gold, no
vision. It has what someone typed.

Rules that keep this from rotting the model:

- **`source = 'manual'`, `riotMatchId = null`**, our own `id`, plus `createdByTeamId` and `createdBy`
  — ownership and "who typed this?" are answerable.
- **Only the key details are required**: date, our five (player + champion), win/loss. Everything else
  is optional, and the stat columns are nullable *for that reason*. A form that demands KDA does not
  get filled in at 23:30 after a scrim block.
- **The kind is a human decision** (`match_annotation.taggedKind`: `scrim` / `tournament` / `custom`),
  because a manual row has no `queueId` to classify. Same slot as a Riot game's re-tag — one place
  answers "what kind of game was this" (§5).
- **No sync touches it**: every sync filters `WHERE source = 'riot'`, so a manual row is
  invisible to them *by construction*, not by discipline — §5.5's rule one level up.
- **Later linking is a human action.** If a tournament code (or a late Riot fetch) turns up the same
  game, a captain attaches `riotMatchId` (guarded by `UNIQUE (riotMatchId)`) and the row keeps its
  hand-entered opponents plus the real stats. Never an automatic merge: after the fact, a wrong merge
  is unfalsifiable.
- **Duplicates are warned, not blocked**: same date + same five champions + same kind → "this looks
  like a game you already entered", one confirm click. Blocking on a heuristic is worse than a
  duplicate.

Downstream, partial data must degrade rather than lie:

- champion stats need only `(championId, win)`, so a scrim counts as a game with no special case
  (§8);
- lane partner / lane opponent are **unknown** when opponents were not entered — render nothing, not
  a guess (§7);
- KDA columns render `–`, never `0/0/0`;
- `teamCount` means "how many of ours were entered", which is true for that row and honest to show.

### 5.9 What the sources do *not* imply

Easy to over-read the fact that three things write into the model:

- **three writers do not mean three tables.** One `match` + `source` keeps `championStats`, the games
  list and the filters single-path — the tournament path writes `match` rows too, it just writes a
  `tournament_game` link beside them;
- **a tournament game is not a second row.** It is a Riot match plus one membership link; storing it
  twice would double-count it in champion stats. This is the whole reason the tournament join is by
  code (§4.7) instead of "also insert what the league tells us";
- manual entry is **not** a fallback for a broken Riot integration, it is a first-class source that
  happens to also work when Riot is unavailable (which is what makes step 4 of §12 possible).

## 6. Flex / SoloQ / Tournament — the classification

`queueId` answers most of it, `tournament_game` answers the tournament question exactly, and one human
override covers the gap.

| Scope | Rule | Comes from |
| --- | --- | --- |
| Solo/Duo | `queueId = 420` | derived |
| Flex | `queueId = 440` | derived |
| Normal | 400 / 430 | derived |
| Custom | `queueId = 0`, `gameType = CUSTOM_GAME` | derived |
| **Tournament** | the match is a member of `tournament_game`, and that tournament's `kind` is `tournament` (§4.7) | membership fact (Riot) + one human label |
| **Scrim** | a code we minted for practice (`tournament.kind = 'scrim'`), or a manual row a captain tagged (§5.8) | human label on a fact |

- `classifyQueue(queueId, gameType)` is the derivation for everything Riot owns, and it **never
  returns `'tournament'`** — that label does not exist in Riot's payload, and pretending otherwise is
  how a league game ends up in the wrong bucket.
- `resolveKind(tournamentKind, taggedKind, queueId, gameType)` — **one resolution order, one
  function**, so the same game cannot be two kinds in two code paths.
- Do **not** treat Riot's `type=tourney` filter or a tournament-code lobby name as the label of
  record: the membership row is the fact (§4.7), and a wrong label is worse than a missing one.
- **Precedence: `tournament.kind` → `annotation.taggedKind` → `classifyQueue` → `'other'`.** The
  membership fact sits on top (a game on our tournament code must not be demoted by a stray re-tag),
  while a game on a *practice* code inherits `scrim` without anyone tagging it per game.
- Once a scrim/tournament calendar exists (the "not built yet" item in `README.md`), the schedule is a
  third confirmation — a game inside a scheduled window is a tournament game. Data we already plan to
  have beats guessing.
- Scrims get their own scope rather than hiding inside "Tournament": they are practice, and mixing
  them into the tournament winrate would be a lie about how the team is doing.

The UI must not pretend the buckets are equally sourced: show provenance per row (`Riot` /
`Turnier-Code` / `manuell`), so nobody concludes a league game is missing from the tournament view when
it was simply never downloaded — a code we never ingested looks exactly like a game that never
happened.

`classifyQueue` and `resolveKind` are plain functions in `packages/shared`, unit-tested against a
table of ids (0, 420, 440, 450 ARAM, 700 Clash, an unknown new id → `other`, never a crash) and
against the precedence cases (tournament kind beats a re-tag, a re-tag beats `queueId`, two nulls →
`other`).

## 7. The lane derivations — inference, labelled as such

Nothing in the API says "this was your lane opponent". It is derived, for SR games only:

```text
partner        = our participant's team, same lane            (BOTTOM ↔ UTILITY)
laneOpponent   = opposing team, same teamPosition
opponentPartner= opposing team, that opponent's lane partner
```

Works cleanly for TOP / MIDDLE / JUNGLE. **Bot lane is the trap**: two opponents, and the sheet's
three columns (`Partner`, `Lane-Gegner`, `Gegner-Partner`) exist precisely because of it. Render
ADC + support as a pair, not as "the enemy".

Honest caveats to encode (as a comment, not as a bug report later):

- role swaps in Flex (two members swapping, autofill) make `teamPosition` a *reported* position, not
  a *playstyle*; leaving the field empty is correct when Riot gives `""`;
- lane swaps, roams and jungle invades make "lane opponent" a game-length average at best. It is
  useful for scouting ("he is up against *that* top"), not authoritative;
- non-SR games (`queueId` 450 ARAM, 1700 Arena) have no lanes → the three columns are empty, and the
  champion-stats view must handle "played, but no role" rather than dropping the row.

`assignLanes(participants)` returns, per puuid, `{ partner, laneOpponent, opponentPartner }` — a pure
function over one match's participants, unit-tested with the bot-lane case, a 1v1-less ARAM match and
an empty `teamPosition`.

### "Team 3/5"

`teamCount` = number of *our* accounts on **this participant's side** — not the total in the game,
which would read as `5/10` and mean nothing to a reader. Derived per row from the join (§5.2);
never stored.

### Remakes

A remake (`durationSeconds` < ~300) is not a game you won or lost. It is a **derivation**
(`isRemake(duration)` in `packages/shared`), not a stored flag: keep the match like any other,
exclude it from champion stats, and show it in the games list with a marker — hiding it entirely
makes "why is my last game not here" a support question. Verify Riot's exact remake shape (duration
threshold, `win` flags) against a real remake before trusting it; both teams reporting `win: false`
is a known quirk.

## 8. Champion stats — the pure part

Input: our participant rows, already joined and filtered. A hand-entered row (§5.8) is just another row
here — this function only ever reads `championId`, `win`, `gameStartAt` and the resolved `kind`, and
none of those can be missing from a record someone bothered to enter. Output: one row per
`(player, champion)`:

```text
championStats(rows, { scope }) →
  [{ playerId, championId, championName, games, wins, losses,
     winrate,              // null when games = 0, so the UI can render "–"
     lastPlayedAt }]       // max(gameStartAt) for that (player, champion) in scope
```

Deliberately in `packages/shared/match-stats.ts`, no DB and no React — same tier as
`mergeIntervals` in the availability idea:

```text
classifyQueue(queueId, gameType)      → kind
filterByScope(rows, scope)            → rows        // 'all' | 'solo' | 'flex' | 'scrim' | 'tournament'
resolveKind(annotation, queueId, gameType) → kind  // taggedKind wins, else classify, else 'other'
championStats(rows, opts)             → rows
winrateTone(winrate, games)           → 'good' | 'meh' | 'bad' | 'none'
formatRelativeLastPlayed(now, then, teamTz) → "19.11." | "11.10."
```

### Cases to pin before implementation

- 0 games → the row has `winrate: null`, the cell renders `–` (never `0%`, never `NaN%`);
- 1 game won → `100%`, but `games: 1` is always rendered next to it. A 100% from one game must not
  look like a 100% from ten. This is the single most misleading number in the whole feature;
- rounding: 2/3 → 67%, 1/3 → 33% (the sheet shows 17% = 1/6, 40% = 2/3… so: round, don't floor);
- `lastPlayedAt` ties → deterministic order, and it is *max* over the scope, so filtering to SoloQ
  must move it (§8.1);
- the same champion on two accounts of one player merges into **one** row under the person (that is
  what "a member can have multiple accounts" means) — but see §10.4, this is a decision;
- a remake never contributes a game (but does not erase a previous `lastPlayedAt`);
- an unknown `queueId` → `other`, and `scope = 'flex'` simply contains no row. No exceptions thrown
  on data we didn't predict.

### 8.1 The scope applies to every number in the row

Filtering is not a display filter. `games`, `winrate` **and** `lastPlayedAt` must all be computed
inside the scope, or the table will show "Flex W/L" next to a date from a SoloQ game. That is exactly
the kind of half-applied filter that reads as a data bug. Hence `{ scope }` as an argument to
`championStats`, not a post-processing step in the component.

## 9. UI

### Games

- **Toolbar**: scope (Alle / SoloQ / Flex / Turnier), player, champion, "only us in it" — as one
  scope value, not five independent filters with undefined combinations (§8.1).
- **Refresh button** with its cooldown visible (§4.6): disabled + "in 7 min" while cooling down,
  spinner while running, and **"Stand: vor 12 Minuten"** next to it. The timestamp is the honest part
  — it makes the hourly loop's lag visible, so nobody reads a missing game as a broken page.
- After a successful refresh, one refetch of the visible list. One, not a poll loop.
- **Rows**: the sheet's columns, minus the ones that are now derived (no `Team` typing).
  Group visually by match (same date + same game marker) so one game reads as one game.
- **Provenance per row**: a small badge — `Riot`, `Turnier-Code`, `manuell` — and `–` wherever a
  manual row simply has no value. One badge, not a caveat paragraph per row.
- **"Spiel eintragen"** (§5.8): date, our five (player + champion + role), win/loss, optional
  opponents and KDA, kind. One screen, no wizard, fillable in under a minute after a scrim block — or
  it will not be used and the champion table will be wrong.
- Manual rows are **editable and deletable by whoever entered them and by the captain**: a typo in a
  scrim is a stat error for the whole team (§10.14).
- **Note** inline-editable, saved per match *and per team* (`match_annotation`).
- **Pagination, not "load everything"**: an 18-month history is thousands of rows. Cursor on
  `(gameStartAt, id)`, not `OFFSET` — our own `id`, since a manual row has no Riot `matchId`.
- Sortable: date (default desc), player, champion, W/L. Column sorting is a URL/param concern so a
  link reproduces a view.

### Champion stats

- Columns per player as in the sheet, headers showing `N Games · M% Winrate` for the *current scope*
  — and the scope selector now has five values (Alle / SoloQ / Flex / Scrim / Turnier), because scrims
  are practice and mixing them into a tournament winrate would be a lie (§6).
- Champion names and icons come from Hexserve (`hexserve-champion-data.md`); a champion the cache does
  not know renders as its id — ugly, but never a blank cell or a spinner.
- Sub-header row: champion / games / W/L / WR / last played. Zero-game champions render greyed with
  `–`, they are informational (see the pool idea) and must not be invisible.
- `WR` cell tone from `winrateTone` — one function, thresholds in one place, unit-tested, the way
  `badges.tsx` maps statuses today.
- Responsive: five player columns don't fit on a phone. Tabs per player is the cheap honest fallback;
  a horizontally scrolling table is the other. Decide, don't ship neither.
- **Pool / "sonst gespielt" grouping and `WR-BASIS` are not this doc** — the table must be
  *filter-scoped* today and *pool-aware* tomorrow. Keeping `championStats` free of pool logic is what
  makes that a small follow-up instead of a rewrite.

## 10. Open questions (yours)

1. **Production Riot key or dev key?** A 24h-expiring dev key cannot back an hourly job that people
   depend on. Production registration needs a real app description and re-verify cadence — a decision
   with lead time, not a config flag. **Less blocking than it was**: with manual entry (§5.8) and the
   hand entry (§5.8), the champion table is useful before Riot is wired up at all. The **tournament
   scope** is the exception: it needs a production key and a registered provider (§4.7). Fallback shape if
   "no": dev key + "Spiele können veralten" notice, never a broken page.
2. **Is optional history loading wanted at all, and at what cap?** The default is "games from now on"
   (§4.5). If someone misses the past, ~100 games per account is the cheap answer. Not a launch
   decision — decide it the first time a player asks.
3. **Retention**: keep matches forever? They are ~60 rows/day now, but a team playing 3 years is a
   different question. My read: keep everything, prune nothing, revisit if a query gets slow.
4. **Whose accounts?** Only `riot_account.isMain`, or every account a member registered? The
   screenshots show several accounts per person (`ACE Mack#021`, `LucioRoyal#EUW`, `Moonman#2211`) →
   **all accounts**, which also means one person's smurf inflates their champion counts. Decide
   whether champion stats are per person (merged) or per account (separated, with the person' s
   header aggregating). I lean merged per person, with the account shown per game row.
5. **SoloQ privacy.** Is a member's SoloQ history visible to the whole team, or opt-in per account?
   `player-profiles.md` treats accounts as self-service; publishing every ranked game of the last
   season is a different statement. Ask before building, it is a one-line `visibility` column now and
   a migration later.
6. **Are non-ranked, non-custom games wanted at all?** Normal draft, ARAM, Arena: in the sheet they
   appear as "Sonst gespielt". Include them (hidden behind a scope) or exclude them from the fetch
   entirely? Excluding shrinks storage and the stat noise.
7. **Does the note belong to the match or to the participant row?** One note per game is what the
   sheet does; if two of ours were in the game, one of them writes the note. (Recommendation: per
   match, in `match_annotation`.)
8. **Can anyone re-tag a match as "tournament"**, or captain only? (§6)
9. **Refresh interval** — hourly is the stated requirement. Configurable (`MATCH_SYNC_MINUTES`), or
   fixed at 60? (Recommendation: configurable, default 60.)
10. **Live-ish or hourly?** A game ends and is invisible for up to an hour — which is now exactly
    what the refresh button (§4.6) is for. Say so in the UI copy so nobody thinks it's broken.
11. **Who may press refresh, and how long is the cooldown?** Any member (simplest, one teammate
    wanting their game now is a normal thing) or captain only? And 5 vs. 10 minutes — the second
    click of an impatient trio is where the budget goes. (Recommendation: any member, 10 min.)
12. **Do we mint our own tournament codes, or ingest the league's?** Minting our own is fully in our
    hands (`POST providers` → `POST tournaments` → `POST codes`) and gives an exact join for every
    game — but the *league's* games are played on the *league's* codes. Verify whether
    `games/by-code/{code}` works for a code from another provider with our key; if not, Prime League
    matches stay manual (§5.8) and the tournament scope is our own events only. This is the single
    question that decides how much of the tournament tab is automatic.
13. **Hexserve icons: hotlink CommunityDragon, or mirror them on Hexserve?** Moved to
    `hexserve-champion-data.md` §9.1 — today `iconUrl` points at `raw.communitydragon.org`.
14. **Who may enter, edit and delete a manual match?** Recommendation: any member may enter, the
    author and any captain may edit or delete. Unlike availability, there is no "my own row only"
    purity to protect here — but a wrong scrim silently skews a player's career stats, so deletion
    probably wants to be captain-or-author, not "anyone".
15. **Does a scrim show up in a player's champion stats at all?** It counts as a game (champion + win
    exist). If someone wants "ranked only" career numbers, that is the `scope` selector's job —
    confirm that filtering to SoloQ/Flex is enough, or whether scrims need a separate toggle.

## 11. Testing

| Layer | What |
| --- | --- |
| unit (`packages/shared`) | `classifyQueue` (table of ids incl. 0/420/440/450/700/unknown), `isRemake` (299 s / 300 s / a long ARAM), `championStats` (0 games, 1 game, rounding, multi-account merge, scope-applied-to-`lastPlayedAt`), `winrateTone`, `assignLanes` (bot lane pair, ARAM, empty `teamPosition`), `formatRelativeLastPlayed` (team tz, DST boundary) |
| unit (`apps/api`) | the incremental cursor: stop-on-known-id, no duplicate writes when the same page is fetched twice, `MAX_PAGES` respected; **the request counter — one shared game, exactly one detail call**; a 404 detail recorded in `match_skip` and never retried; note/`taggedKind` preservation across two syncs (§5.5); the token bucket (10 accounts do not exceed 100 req/2 min); `manualRefreshState` at the cooldown boundary, with no prior refresh, and with `now` slightly behind `lastAt` |
| integration | **same match from five accounts → exactly one `match` row, one detail request, five of ours in `teamCount`**; a second sync of the same window writes nothing new *and requests nothing already stored*; an `riot_account` added later retroactively matches games already in the DB without refetching them; archiving an account keeps its games attributed instead of orphaning them; re-tagging a match as tournament survives a sync; 429 leaves `lastError` and retries next tick without losing the cursor; **a second refresh click inside the cooldown → 429 with `retryAfterSeconds` and zero Riot requests**, a click while a cycle is already running → `{ started: false }` not a second cycle, a click that fails still spends the cooldown, and the cooldown is shared by two different members of the same team |
| web | `–` at 0 games, `100% / 1 game` rendered together, tone per threshold, scope switch recomputes the whole row including the date, a player with no games yet renders as empty rather than as zeros, `–` for every field a manual row lacks, provenance badge per row |
| Hexserve (web + one integration) | a champion the cache does not know renders as its id with a placeholder and no crash; a game whose `gameVersion` predates the dump renders with the **current** icon like every other game (§5.7); the cache's own suite lives in `hexserve-champion-data.md` §10 |
| source integrity (integration) | a manual match appears in champion stats with `–` instead of KDA; linking it to a Riot row leaves one row and `UNIQUE (riotMatchId)` refuses a second link; a Riot sync over a window containing a manual row writes nothing; `resolveKind` precedence survives a re-sync (a `taggedKind` scrim is still a scrim, and a tournament-game is still a tournament-game) |
| tournament codes (integration + fake Riot) | `games/by-code` returning `[7123456789]` produces/links exactly one match `EUW1_7123456789` and one `tournament_game` row; the same code polled twice writes nothing new; a code with no games yet writes nothing and still updates `lastCheckedAt`; a game already stored via the account loop gains the membership link without being re-fetched; a practice-code game inherits `scrim`; 403 (no provider / dev key) degrades to "Turnierdaten fehlen" and never blocks the games list |
| fake client | `createFakeRiotClient` (from `player-profiles.md`) replays recorded payloads: normal, remake, custom-tagged, 429, partial page, an unknown champion id |

The end-to-end test worth writing first: **one recorded Flex game with five of our accounts, fetched
per-account in a loop** — because that one test fails against every naive implementation of this
feature (five matches, or one match with a wrong count).

## 12. Suggested sequencing (each step lands green)

0. Decide §10.1 (key) and §10.4 (per person vs. per account). Nothing else blocks; §10.2 (optional
   history loading) can stay open indefinitely and §10.12 (own codes vs. the league's) only blocks
   step 7.
1. **Schema only**: `match`, `match_participant`, `match_annotation`, `match_skip`, `account_sync` +
   migration + the invariant tests (one match from many accounts; no column from the forbidden
   buckets of §5). No Riot calls yet.
2. **`packages/shared/match-stats.ts`** + full unit suite. Pure, offline, fast.
3. **Fetch path**: `RiotClient.getMatchIds/getMatch` behind the injected client, plus the fake.
   First integration test: recorded pages in, correct rows out.
4. **The loop**: advisory lock, token bucket, `account_sync` state machine. Test with a fake clock
   and a fake Riot that counts requests. No history loading here — if it ever gets built, it slots in
   afterwards as a capped add-on (§4.5).
5. **Manual entry** (§5.8) + **both views** (Games and Champion stats, §9). *This is the step that
   delivers the screenshots* — the motivating table works with zero Riot integration, zero API key,
   and real data from the first scrim. Everything after this makes it automatic instead of manual.
6. **Hexserve consumption**: the client, the cache and its version check are `hexserve-champion-data.md`
   (one small doc of its own), so this step is just the lookup — games list and stats table render
   names and icons instead of numeric ids. Do it early if that doc is not built yet; it is cheap.
7. **Tournament codes** (§4.7): `getGamesByCode` on the existing `RiotClient`, the `tournament` /
   `tournament_code` / `tournament_game` tables, idempotent membership, degrade on 403. Minting codes
   for our own events can wait; *ingesting* a code the league handed out is the useful half.
8. Hardening: refresh-now polish, production key, observability (one log line per cycle: accounts due
   / succeeded / failed / requests used / patch version).

## 13. Forward pointer — the pool idea

The sheet's `WR-BASIS: "Nur Pool-Champs"`, the two-tier table (pool vs. "Sonst gespielt (nicht im
Pool)") and the top-right note *"Pool kommt automatisch"* belong to a separate idea about champion
pools. This doc stops before it, on purpose, and the split is worth keeping:

- here: **what happened** — games, participants, per-champion results, scope filters;
- there: **what a player is supposed to play** — pool membership, and only then the "in pool" /
  "outside pool" split and the pool-restricted winrate.

The interface between them is one function call: the pool idea consumes `championStats(rows, {scope})`
and partitions it. If this doc started storing `isInPool` on a match row, that boundary would be
gone and the grouping would have to be undone later.

Two inputs for it already exist here, and neither is a pool:

- **Hexserve's `positions[]` / `roles[]`** per champion (`hexserve-champion-data.md` §2) — the prior,
  "this champion is normally MIDDLE / is a MAGE·BURST";
- **Riot's `teamPosition`** per game (§7) — the fact, "this is where it was actually played".

Pool membership itself will be a third kind of row: a human decision, stored like
`match_annotation`, never derived from winrate or Riot defaults.
