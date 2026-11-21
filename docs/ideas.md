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
"nothing implemented" over shipped code is a bug, not a backlog note. `quick-wins.md` (findings only)
and `web-architecture.md` (nothing refactored yet) are plain `idea` rows; their status lines say what
kind of note they are.

Order is dependency order, not importance: **4 of the 13 still hang off `multi-team`**, which is why
it sat at the top — and why closing it (see **Done**) unblocked the front of the queue: tenancy and
profiles are both done, so `availability-planner` is the next thing that is actually buildable.

| Idea | What it is | Depends on | Status |
| --- | --- | --- | --- |
| [riot-api](ideas/integrations/riot-api.md) | The only module that speaks Riot — an injected client over two host families, a summoner/rank snapshot, and a status→sentence mapping so saving still works when the 24-hour dev key is dead; used by player-profiles and, later, match-history. | — | idea |
| [hexserve-champion-data](ideas/integrations/hexserve-champion-data.md) | Champion names/icons and the patch come from the team's own Hexserve dump instead of Data Dragon — current patch plus one, German names, no third-party rate limit. | — | idea |
| [availability-planner](ideas/roster/availability-planner.md) | Everyone fills in when they can play; the team sees one merged summary of playable times and who would be missing, in wall clock, over a two-week window that nothing ever deletes from. | multi-team, player-profiles | idea |
| [team-home](ideas/frontend/team-home.md) | The front page per team: patch, next playable window, next match, roster by role incl. sub and coach, next birthdays, tasks/goals, meeting topics, useful links. Read-only composition of the other features. | multi-team, player-profiles, availability-planner, matchdays, hexserve | idea |
| [matchdays](ideas/matches/matchdays.md) | Record Liga and scrim matchdays: opponent, BoN, per-game W/L + side + VOD, scouting from a pasted op.gg multisearch URL, Bilanz and head-to-head. Hand entry is the normal path — Riot usually cannot see these games. | multi-team, player-profiles | idea |
| [match-history](ideas/matches/match-history.md) | Hourly pull of every member's Riot games into a games list and champion stats — Riot-visible games only; fixtures and sides come from `matchdays`. | multi-team, player-profiles, hexserve | idea |
| [champion-pools](ideas/roster/champion-pools.md) | Each player curates main / situational / blind-pick pools in their own order; one team-wide blind-pickable list per role. | player-profiles, hexserve | idea |
| [discord-digest](ideas/integrations/discord-digest.md) | One weekly Discord post per team via a webhook (no bot): playable window, who hasn't answered, fixtures, roster gaps. Exactly-once sending via a claim row. | team-home, availability-planner, matchdays | idea |
| [realtime](ideas/frontend/realtime.md) | Edits appearing for everyone at once: Tier 0 (focus refetch, optimistic writes, one poll) vs SSE + an injected bus. Events are refetch hints, never state. | — | idea |
| [change-visibility](ideas/engineering/change-visibility.md) | What a mutation actually changed: field names and enum before→after in the log, the build version at boot, and — only if accountability is wanted — a transactional `change_log` table. Debugging and audit are separate goals. | logging | idea |
| [web-architecture](ideas/engineering/web-architecture.md) | Behaviour-preserving refactor: get server state, mutations, derived rules and form state out of `RosterPage`/`AdminPage` into plain modules and hooks. | — | idea |
| [quick-wins](ideas/engineering/quick-wins.md) | Findings from the module walkthrough: dead exports, a duplicate index, one-line inconsistencies, small extractions — cheapest first, each with its test rule. | — | idea |
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
| [player-profiles](ideas/done/player-profiles.md) | Two owners for one row, separated instead of negotiated: `profile` and `riot_account` are player-owned (names, accounts with a DB-enforced single main, preferred role, optional birthday), `roster_entry` stays captain-owned and is always a member; the roster is a join, so an edit propagates because there is no copy. Includes the blocking first-login gate and `DROP TABLE player`. Riot validation was split out into `riot-api` and never landed here — every account is unverified by design. | 2026-11-21 |
| [logging](ideas/done/logging.md) | One line per request plus domain events, to the console and a rotating NDJSON file, so "did it do the thing?" is answerable: a thin pino facade, `x-request-id` correlation with a request-scoped `WeakMap`, credential redaction, `auth.denied`, invite/roster/lifecycle events, and the docker `api-logs` volume. Not an audit log. | 2026-11-21 |
| [migration-safety](ideas/done/migration-safety.md) | A migration can no longer take prod down silently: static rules reject `ADD COLUMN … NOT NULL` without a default, `SET NOT NULL` without an `UPDATE`, and un-allowlisted drops; every migration from `0003` on is replayed against a database with a row in every table; an advisory lock keeps replicas from migrating at once; and `docker compose up` refuses to start the app unless a pre-migration dump succeeded. Written from a real incident; the historical backfill and the image-vs-legacy fixture were deliberately dropped. | 2026-11-21 |
| [team-rename](ideas/done/team-rename.md) | A captain renames their team from the admin page; the slug follows the name (option A), so the SPA navigates to the new URL and old links 404. Found and fixed a page-level bug on the way: captaincy came from `/api/me` (the oldest membership) instead of the team in the URL. | 2026-11-20 |
| [multi-team](ideas/done/multi-team.md) | Team as tenant: `membership` rows replace role/status on the global user, path-scoped `/api/teams/:slug`, `POST`/`GET /api/teams`, the create-team form and header switcher, and a `TeamScope` handle every tenant route must go through. The bootstrap and `CAPTAIN_DISCORD_IDS` are gone. RLS deliberately skipped. | 2026-11-20 |
