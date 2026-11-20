# Idea — the weekly Discord digest

**Status:** idea, nothing implemented.
**Depends on:** `multi-team.md` (a digest per team), `availability-planner.md` (the playable-window
summary), `matchdays.md` (the fixtures), `team-home.md` §3 (the summary this renders).
**Not the same thing as:** `realtime.md` — that one is in-app freshness; this one is "tell Discord".
`realtime.md` §9 rules out Web Push; this doc is the cheap cousin that needs no service worker, no
VAPID, no browser permission.
**Prefers a webhook over a bot** — §2. A real bot is Level 2 and it is not obviously worth it.

## 1. The idea

Once a week, the team gets a Discord message that answers: *when can we play, what's scheduled, and
who still hasn't said anything?* — with links back into the app for anything actionable.

The whole feature is:

```text
a scheduler tick  →  buildHomeSummary(team)  →  renderDigest(summary, tz)  →  POST to a webhook
```

Three of those four already exist or are specified elsewhere. The interesting parts are
**exactly-once sending** (§5), **what a channel may see** (§4), and **not building a bot** (§2).

## 2. First decision: webhook or bot?

"Discord bot" usually means a gateway connection and a library. That is a *process*, an *intent
model*, *verification*, and a second thing that can be down — for a weekly text message.

| | Incoming webhook | Real bot (gateway) |
| --- | --- | --- |
| Setup by a team | create a webhook in one channel, paste the URL | invite a bot application into the guild, permissions per channel |
| Code | `POST` JSON, zero dependencies | long-lived gateway, `discord.js`, intents, sharding/keepalive, reconnect |
| Posts to | **one channel** | any channel/guild it is in |
| **DMs a person** | impossible | yes |
| Slash commands / buttons | impossible | yes |
| Who can be pinged | members of that channel (with mention rules) | — |
| Hosting | nothing — the API already runs | a second container or a background loop, plus a token secret |
| Failure mode | a 404 on a rotated URL | a stale session, a missing intent, a dropped gateway — all silent-ish |

**Recommendation: Level 0 = webhook.** A weekly digest is a scheduled post to one channel; that is
exactly what a webhook is for, and it needs no token, no bot user, no second process, no library.

Level 2 (a real bot) becomes justified by exactly two things: **DMs** ("remind *me*") and **commands**
("`/matchday new`"). Neither is in this idea. Write that down so the next step is a decision, not a
drift (§9).

## 3. The digest is a second renderer of the home page — not a second query

This is the design that makes the feature small, and it is worth being pedantic about:

```text
team-home.md §3    buildHomeSummary({ team, roster, window, matches, tasks, topics, birthdays })
                        ↓                        ↓
                   TeamHomePage (Mantine)   renderDigest (Discord markdown)
```

- **The same pure summary feeds both.** No digest-specific SQL, no second definition of "next playable
  window", no drift between what the page says and what Discord says.
- `renderDigest(summary, { timezone }) → string` is pure: no `fetch`, no clock, no DB. It takes
  `teamNow` as an argument. Unit-testable with a fixture summary and a golden string — which is
  exactly how a digest should be verified, because the output *is* prose.
- If the home page does not exist yet, the digest does **not** wait for it: `buildHomeSummary` is a
  pure function that can be written and tested on its own, with `null` sections. The page is one
  renderer; Discord is another; both arrive when they arrive.

What the message contains (and its priority order — see the length problem in §6.3):

```text
1. Playable window        "Tue 20:00–23:00 (5 free), Thu 21:00+ (4 free)"
2. Missing answers        "Still no answer: @X, @Y"          ← the only line that causes action
3. Fixtures this week     "Tue 19:00 Scrim vs Anes · Thu 20:00 ACE League vs 5 Elements"
4. Roster gaps (if any)   "MID is open"                     ← only when something is missing
5. Goal / top tasks       one line each, optional
6. Link                   "→ open the team page"
```

Sentences, not tables: Discord markdown has no real tables, and a wall of `|` in a chat window is
worse than three lines of prose. The digest is a *nudge*, the app is the source of truth — every
section ends in a link, not in detail.

## 4. What a Discord channel may see (this is not the team page)

A channel is a different audience than `RequireMember`: it may include former members, friends,
subs, guests, a coach, and whoever else was invited — and it **keeps history** in a place we cannot
redact. So:

- **No birthdays** by default. `team-home.md` §6 already restricts them to teammates; a channel is not
  teammates. If wanted later, it must be a per-profile opt-in for "public to the team's Discord" — and
  that is a new consent, not a settings toggle.
- **No notes of any kind**: scouting notes, match notes, task details. They are colour, not schedule.
  "Tue 20:00–23:00" is not sensitive; "their jungler always level-2 ganks bot" is scouting intel.
- **"Who hasn't answered" is a nudge, not a wall of shame.** It is the single most useful line in the
  message and the single most likely to annoy. Cap it, phrase it neutrally ("not answered yet"), and
  make the whole section configurable per team (some teams hate it).
- **Mentions**: use `<@discordId>` only for the "missing answers" line, cap at ~3, and set
  `allowed_mentions: { parse: [] }` with explicit `users` ids everywhere else. A digest that
  accidentally `@everyone`s a six-person server is the fastest way to get the webhook deleted.
- Anything the captain can turn off should be a boolean per team, not a code change.

## 5. "Once per week" is not a cron expression

The hard requirement is not *when* to send but **not sending twice and not silently skipping**.

### 5.1 Due-ness is a pure function of the team's clock

```text
digestDue(team, now) → { due: boolean, weekStart: 'YYYY-MM-DD' }
  slot      = the team's configured weekday + minute, in team.timezone
  weekStart = Monday of the week containing `now`     ← same Monday as availability-planner
  due       = now >= this week's slot
```

- Same wall-clock reasoning as `availability-planner.md` §3 and `team-home.md` §6: "Monday 18:00" is
  the team's local 18:00, computed with the team's timezone, not a UTC instant. A UTC cron fires at
  19:00 after the DST switch, in the week the digest matters most.
- `now` is passed in. The function has no `Date.now()` inside, so the test suite can walk a whole year
  including both DST switches in microseconds.
- Default: **Monday 18:00, team time** — before the week starts, after the weekend's availability
  answers exist.

### 5.2 The claim row — what makes it exactly-once-ish

A timer plus "have I sent this week?" in memory is wrong in the two ways that matter: a restart
re-sends, and a crash on Monday means no digest until next Monday.

```text
digest_run   id, teamId → team, weekStart date, claimedAt, sentAt?, messageId?, error?,
             UNIQUE (teamId, weekStart)          ← the whole mechanism
```

Order matters and is the entire trick:

```text
1. INSERT … (teamId, weekStart)          ← claims the week; UNIQUE makes the second process lose
2. render + POST
3. UPDATE … sentAt = now (or error = …)  ← the receipt
4. on crash between 1 and 3: the row exists with sentAt = NULL, claimedAt > retryWindow ago
   → retried, after a delay long enough that a slow-but-successful send is not repeated
```

- **Catch-up is deliberate**: if the process was down at 18:00, the digest still goes out on Tuesday
  morning ("you missed Monday" is better than silence). A `catchUpUntil` (e.g. 48 h after the slot)
  bounds it, so a two-week outage does not produce a burst of stale digests.
- A missed week is a **row with `sentAt = NULL` and an `error`** — i.e. the failure is *visible and
  queryable*, not a line in a log nobody reads. That is the same "did it do the thing?" rule as
  `../done/logging.md`, but stored where the captain can see it.
- No cron library, no external scheduler: a `setInterval` tick of 5–15 minutes calling
  `digestDue()` for each enabled team. Six teams × 1 query per tick is nothing. (Single-process,
  which is the same assumption as `realtime.md` §5.3 — and here the UNIQUE row makes a *second*
  instance merely redundant, not a double-send. That is a nice property: the claim table is the
  cheap version of the "single replica" problem.)

### 5.3 Where the tick lives

`index.ts`, next to `app.listen()` — **not** inside `createApp()`.

`createApp` is the composition root the integration tests call in-process; a timer started there means
every test leaks an interval and eventually posts to a real webhook. Keep it out of the app object and
the whole feature stays unit-testable. (`AGENTS.md`: dependencies injected, side effects at the edge.)

## 6. The sender

### 6.1 Injected, like `db`, `auth` and the future `riot`

```text
apps/api/src/discord/client.ts   DiscordClient { postMessage(webhookUrl, payload): Promise<Result> }
                                 createDiscordClient({ fetch })        ← real
                                 createFakeDiscordClient({ responses }) ← tests
createApp({ db, auth, discord })          ← route handlers (test message, URL validation)
runDigestTick({ db, discord, now })       ← the scheduler entry point
```

Same argument as everywhere else in this codebase: the tests must be able to answer `429`, `500`,
`404` and a timeout without a network, and without a `fetch` mock smuggled through module globals.

### 6.2 Failure policy — one sentence per status

| What Discord says | Meaning | Do |
| --- | --- | --- |
| 204 | posted | `sentAt`, done |
| 429 | rate limited | honour `retry-after` (seconds), retry once; it is per-webhook ~30/min, so this should never happen with a weekly post |
| 5xx / timeout | Discord's problem | retry with backoff within the catch-up window, then `error` |
| 404 / 401 | **the webhook is gone** (rotated, channel deleted) | do **not** retry forever: mark the team's webhook invalid, surface it to the captain in the UI, skip future weeks |

The 404 case is the important one: a deleted channel turns a naive bot into a permanent retry loop
against Discord, which is a good way to get rate-limited globally for the whole server.

### 6.3 Length and structure

Discord caps a message at **2000 characters** (verify current limits before implementing — they have
changed). A digest of a busy week can exceed it. Truncate by **priority** (§3 order), not by
character count: keep the window and the missing answers, drop tasks, drop roster gaps, and append
`…` plus the link. Never split into multiple messages — two messages a week reads as spam and breaks
the "one digest" mental model.

### 6.4 Dry run

A captain-only **"Send test message"** button that renders the *current* digest and posts it once,
bypassing the claim row. Without it, the first real send is the first time anyone sees the format —
and the failure lands on a Monday evening.

## 7. Identity: we already know who is who

The user's Discord id is **already in the database**, for free:

- `account.accountId` with `providerId = 'discord'` is the Discord user id (better-auth's row for the
  OAuth account). No new table, no linking flow.

Consequences and traps:

- `<@id>` mentions work today for anyone who logged in via Discord — which is *everyone*, since Discord
  is the only login. A player row with `userId = NULL` (free-typed roster entry,
  `player-profiles.md` §6) has **no** Discord id → they must render as plain text, never as a broken
  `<@null>`. The renderer takes `{ displayName, discordId | null }` and decides.
- **Never** build the digest around the Discord *username* — it changes. The id is the identity, the
  same rule as `puuid` vs Riot ID in `player-profiles.md` §3.
- DMs (Level 2) would use the same ids and a bot token; nothing else changes.

## 8. Configuration and schema

```text
team   + timezone (already needed by the planner)
       + digestEnabled boolean default false
       + digestWeekday int 0-6 default 0 (Monday)
       + digestMinute int default 1080 (18:00)
       + discordWebhookUrl text?          ← a secret, §8.1
       + digestSections jsonb?            ← which blocks, §4; or one boolean per block

digest_run   §5.2
```

**Today, with no `team` table yet**, the honest v1 is `DISCORD_WEBHOOK_URL` +
`DISCORD_DIGEST_WEEKDAY`/`_MINUTE` in `env`, single team — the same "one team first, then
`multi-team.md`" order the rest of the project is already on. The tick and the claim table are
identical; only the source of the URL and schedule moves from env to a row. Do not build the settings
UI before teams exist.

### 8.1 The webhook URL is a bearer secret

Anyone holding it can post to that channel (and impersonate anything). Treat it exactly like a
password:

- **never returned by the API** — `GET /settings` returns `{ hasWebhook: true, tail: '…ab12' }`;
  writes accept a full URL, reads never echo it.
- **never logged** — not the URL, not the payload-with-URL, not on error. (`../done/logging.md` is the place
  to state this once for the codebase: a redaction rule for known-secret fields.)
- captain-only to set/rotate; changing it clears past failures and resets the invalid flag.
- A leaked URL is rotated by deleting the webhook in Discord — say so in the UI copy.
- The payload itself is derived from team data, so it must obey §4 (the channel is not the team page).

## 9. Level 2: the actual bot, and when it earns its keep

Only two features are impossible with a webhook, so only two can justify a gateway process:

1. **DMs** — "remind me personally". Note that Web Push does the same job inside the app without
   Discord (`realtime.md` §9); pick one, not both.
2. **Slash commands** — `/matchday new`, `/availability set`, `/matchday result 2:1`.

The second one has a *good* design and a *bad* design:

- **Bad:** the bot gets a service token and re-implements the permission rules ("member can record a
  result, captain can delete"). That is a second copy of `lib/access.ts` in a second process, and it
  will drift. This is the same failure as a second definition of "next playable window".
- **Good:** the command resolves `discordId → user` (via `account`, §7) and calls the **same route
  factories** in-process with that identity, so every guard applies unchanged. The command handler
  becomes a thin adapter: parse → call → render the response as an ephemeral reply.
  Cost: an internal call path that takes an explicit identity instead of reading a cookie — which
  is a real refactor of `plugins/auth.ts`, not a one-liner. That is why it is Level 2.

Costs either way: a token secret, a second container (or a background loop inside the API), gateway
reconnects, `discord.js` as a dependency, and the app's first long-lived outbound connection.
Precondition for Level 2 is not "we want commands"; it is "we've run the digest for a month and the
team asks for it".

## 10. Testing

The feature is deliberately shaped so almost everything is pure:

- `digestDue(team, now)` — a table of dates: exactly at the slot, a minute before, Tuesday after a
  missed Monday (catch-up), 49 h late (outside the window → skip), both DST switches, a team with
  `digestEnabled = false`, weekday/minutes at the edges (00:00, 23:59), disabled → never due.
- `renderDigest(summary, tz)` — golden strings from fixture summaries: an empty team (suppresses the
  message entirely per §3/§4 — the "nothing to say" case must not post), a full week, over-length
  (truncation order follows the priority list, the link survives), a player without `userId`
  (plain text, no `<@null>`), zero missing answers (section omitted, not "0 players").
- `shouldPost(summary)` — the suppression rule as its own pure function, so "don't be noise" is
  testable rather than a comment.
- Sender with the fake client — 204 → `sentAt` set; 429 → one retry honouring `retry-after`; 500 →
  retried then `error`; 404 → marked invalid **and not retried on the next tick** (§6.2);
  timeout → treated as 5xx.
- Integration (throwaway DB): claim a week twice → the second call is a no-op (UNIQUE wins, no second
  POST — assert on the fake client's call count, which is the point of injecting it); a crashed claim
  older than the retry window is retried exactly once.
- A structural test worth its three lines: **`createApp()` starts no timers** — instantiate the app in
  a test, wait a tick, assert the fake Discord client got no calls (§5.3). That is the test that stops
  the test suite from ever messaging a real channel.

## 11. Open questions

1. **Which day and time?** Monday 18:00 is my default (§5.1). A Sunday-evening digest ("the week
   ahead") may fit the team's planning rhythm better — it is a config value either way, but the
   default should match when people actually answer availability.
2. **Does the missing-answers line mention people (`<@…>`) or not?** Mentions cause action *and*
   annoy. Suggest: mentions for the first week a person is missing, plain names afterwards — or make
   it a per-team setting and observe.
3. **One digest or two?** The user asked for once per week. A separate "scrim in 3 hours" ping is a
   different feature (event-driven, §5 machinery is the same, spam risk is not). Decide explicitly
   rather than letting the weekly digest grow triggers.
4. **Second channel for matchdays?** Some teams keep `#planung` and `#matches` apart. Two webhook
   URLs is cheap; two digests is not. Defer until asked.
5. **What happens to a team with no webhook configured?** Silent, forever? Or one captain-facing nag in
   the app ("your team has no digest")? The app-side nag is probably right; a Discord-side one is
   impossible by construction.
6. **Does the digest respect archived/hidden state?** It should read exactly what the home page shows
   for a member — no more, no less. That equivalence is the cheapest way to keep §4 honest, and worth
   stating as an invariant in the code.
