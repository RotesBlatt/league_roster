# Ideas — the register

One row per idea, one line each, so "what were we thinking?" is answerable without opening 4000 lines
of design notes. The full docs live in `docs/ideas/`; each carries a status line, its dependencies,
a schema sketch, the decisions that were forced, and its open questions.

**Convention: a new idea = a new doc in its set folder under `docs/ideas/` + a row here, in the same
commit.** A row without a doc is a reminder; a doc without a row is invisible.

## The sets

`docs/ideas/` is grouped into **sets**, one folder each, so the backlog is scannable by area instead
of by 14 sibling files. A set is a place to look, not a taxonomy: it names who would care, nothing
more. The list below is the current shape, not a limit — **when a group of ideas outgrows its folder
or a new theme appears, add a folder and a row to this table in the same commit.** One doc in a new
folder is a fine reason to create it; empty folders are not.

| Folder | For ideas about |
| --- | --- |
| [`engineering/`](ideas/engineering/) | The codebase and how it is kept honest: deploy and migration safety, logging, refactors and tech debt, URL contracts. Invisible to players — these pay off in fewer incidents and shorter debugging. |
| [`roster/`](ideas/roster/) | The people: who a member is, when they can play, what they want to play. Player-owned data and the schedule built on it. |
| [`matches/`](ideas/matches/) | The record of games: Liga and scrim matchdays, Riot-visible match history, results and stats. |
| [`frontend/`](ideas/frontend/) | What a member actually sees and feels: the team home page, live updates. A doc lands here when its deliverable is a page or a UX behaviour. |
| [`integrations/`](ideas/integrations/) | Data we do not own: the Hexserve champion/patch dump, the Discord webhook. Anything whose contract lives outside this repo. |
| [`done/`](ideas/done/) | Shipped ideas, kept for their reasoning. See its [README](ideas/done/README.md) for when a doc is allowed in. |

**Three states, recorded in two places.** The doc's own `**Status:**` line is authoritative; the
`Status` column below mirrors it, so the queue is answerable without opening 14 files.

| state | means | what changes |
| --- | --- | --- |
| `idea` | written up, no code. | nothing |
| `in progress` | part of it is running in the app. | the status line names what landed and what is still missing; this row says `in progress` |
| `done` | implemented and settled. | the doc moves to `docs/ideas/done/`, its row moves to the **Done** table, the status line records the date and the commits |

**Updating the doc is part of implementing it.** The patch that lands behaviour updates its status
line and its "decided while implementing" section in the same commit — a doc that still says
"nothing implemented" over shipped code is a bug, not a backlog note. `web-architecture.md` (nothing
refactored yet) is the remaining plain `idea` row; `quick-wins.md` is now `in progress` and carries a
"Where this stopped" handoff section — the place to resume from when a working session ends
mid-queue.

Order is dependency order, not importance: **3 of the 10 still hang off `multi-team`**, which is why
it sat at the top — and why closing it (see **Done**) unblocked the front of the queue: tenancy and
profiles are both done, and `availability-planner` — the next thing that was actually buildable —
is now done as well. The front of the queue is now `matchdays` and `team-home`, not another refactor:
`quick-wins` and `realtime` are the two `in progress` rows.

| Idea | What it is | Depends on | Status |
| --- | --- | --- | --- |
| [team-home](ideas/frontend/team-home.md) | The front page per team: patch, next playable window, next match, roster by role incl. sub and coach, next birthdays, tasks/goals, meeting topics, useful links. Read-only composition of the other features. | multi-team, player-profiles, availability-planner, matchdays, hexserve | idea |
| [matchdays](ideas/matches/matchdays.md) | Record Liga and scrim matchdays: opponent, BoN, per-game W/L + side + VOD, scouting from a pasted op.gg multisearch URL, Bilanz and head-to-head. Hand entry is the normal path — Riot usually cannot see these games. | multi-team, player-profiles | idea |
| [match-history](ideas/matches/match-history.md) | Hourly pull of every member's Riot games into a games list and champion stats — Riot-visible games only; fixtures and sides come from `matchdays`. | multi-team, player-profiles, hexserve | idea |
| [champion-pools](ideas/roster/champion-pools.md) | Each player curates main / situational / blind-pick pools in their own order; one team-wide blind-pickable list per role. | player-profiles, hexserve | idea |
| [discord-digest](ideas/integrations/discord-digest.md) | One weekly Discord post per team via a webhook (no bot): playable window, who hasn't answered, fixtures, roster gaps. Exactly-once sending via a claim row. | team-home, availability-planner, matchdays | idea |
| [realtime](ideas/frontend/realtime.md) | Edits appearing for everyone at once: Tier 0 (focus refetch, optimistic writes, one poll) vs SSE + an injected bus. Events are refetch hints, never state. **Focus refetch landed 2026-11-26** (`apps/web/src/lib/query/client.ts`); reconnect/visibility, optimistic writes and the poll are still open, and Tier 1 (SSE) is untouched. | — | in progress |
| [change-visibility](ideas/engineering/change-visibility.md) | What a mutation actually changed: field names and enum before→after in the log, the build version at boot, and — only if accountability is wanted — a transactional `change_log` table. Debugging and audit are separate goals. | logging | idea |
| [web-architecture](ideas/engineering/web-architecture.md) | Behaviour-preserving refactor: get server state, mutations, derived rules and form state out of `RosterPage`/`AdminPage` into plain modules and hooks. | — | idea |
| [quick-wins](ideas/engineering/quick-wins.md) | Findings from the module walkthrough, re-verified: the dead helper, the duplicate index and the two member rules are done (A1/A3/C1); what is left is the over-strict last-captain rule (C2) and DB `CHECK`s generated from the shared enums (D1). Its "Where this stopped" section is the resume point. | — | in progress |
| [team-slug-history](ideas/engineering/team-slug-history.md) | A retired team slug keeps answering: a `team_slug_history` row per rename and a 308 on the SPA path, so an old `/t/<slug>/…` link still lands on the team. Deliberately deferred when renaming shipped. | team-rename | idea |

## Not written up yet

- **Google Sheets import** — bring the old sheet's roster and matches into Postgres (listed in the
  README as slice 1, no doc yet: the open question is what the old data is worth keeping).

## Done

Finished ideas leave the queue but keep their doc: the reasoning, the rejected options and the
decisions are worth more after the code exists, not less. The doc moves to `docs/ideas/done/` (see
its README) and its row moves here, in the commit that finishes it.

| Idea | What it did | Landed |
| --- | --- | --- |
| [hexserve-champion-data](ideas/done/hexserve-champion-data.md) | Champion labels come from our own per-patch dump instead of Data Dragon: a two-patch `champion` cache with the patch's own facts in `champion_patch`, a lazy transactional refresh (version comparison, never a TTL; advisory-locked; pruned by the dump's timestamp, not by version strings), `GET /api/champions` flattened server-side to one label per id, `useChampions` + `ChampionIcon`/`ChampionLabel` rendering unknown ids as placeholders, `HEXSERVE_BASE_URL` config, and a header chip showing the patch and the day it was published. Icons still come from CommunityDragon, and no page renders a champion yet — that is `champion-pools`/`match-history`. | 2026-11-25 |
| [availability-planner](ideas/done/availability-planner.md) | Everyone paints when they can play on a 30-minute grid, starting from their regular slots and autosaved; the team sees one merged provisional summary of playable times and who would be missing, in wall clock (30-minute cells, `1440` = midnight), over a two-week window that is derived from the team's clock and never stored. Captains skip/reset, unlock a finished week for seven days, and mark a week "no practice"; history is a read of any Monday and lists every week back to the first one with data. | 2026-11-25 |
| [riot-api](ideas/done/riot-api.md) | The only module that speaks Riot: an injected client over two host families, types generated from a pinned spec, and a snapshot (level, icon, both ranks) written on save by re-resolving server-side. Adding an account **is** the check — no separate endpoint — and since `puuid` is required, an account Riot cannot resolve is refused and the rows that never resolved were deleted. | 2026-11-21 |
| [player-profiles](ideas/done/player-profiles.md) | Two owners for one row, separated instead of negotiated: `profile` and `riot_account` are player-owned (names, accounts with a DB-enforced single main, preferred role, optional birthday), `roster_entry` stays captain-owned and is always a member; the roster is a join, so an edit propagates because there is no copy. Includes the blocking first-login gate and `DROP TABLE player`. Riot validation was split out into `riot-api`, which landed the same day (see above). | 2026-11-21 |
| [logging](ideas/done/logging.md) | One line per request plus domain events, to the console and a rotating NDJSON file, so "did it do the thing?" is answerable: a thin pino facade, `x-request-id` correlation with a request-scoped `WeakMap`, credential redaction, `auth.denied`, invite/roster/lifecycle events, and the docker `api-logs` volume. Not an audit log. | 2026-11-21 |
| [migration-safety](ideas/done/migration-safety.md) | A migration can no longer take prod down silently: static rules reject `ADD COLUMN … NOT NULL` without a default, `SET NOT NULL` without an `UPDATE`, and un-allowlisted drops; every migration from `0003` on is replayed against a database with a row in every table; an advisory lock keeps replicas from migrating at once; and `docker compose up` refuses to start the app unless a pre-migration dump succeeded. Written from a real incident; the historical backfill and the image-vs-legacy fixture were deliberately dropped. | 2026-11-21 |
| [team-rename](ideas/done/team-rename.md) | A captain renames their team from the admin page; the slug follows the name (option A), so the SPA navigates to the new URL and old links 404. Found and fixed a page-level bug on the way: captaincy came from `/api/me` (the oldest membership) instead of the team in the URL. | 2026-11-20 |
| [multi-team](ideas/done/multi-team.md) | Team as tenant: `membership` rows replace role/status on the global user, path-scoped `/api/teams/:slug`, `POST`/`GET /api/teams`, the create-team form and header switcher, and a `TeamScope` handle every tenant route must go through. The bootstrap and `CAPTAIN_DISCORD_IDS` are gone. RLS deliberately skipped. | 2026-11-20 |
