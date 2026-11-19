# Ideas — the register

One row per idea, one line each, so "what were we thinking?" is answerable without opening 4000 lines
of design notes. The full docs live in `docs/ideas/`; each carries a status line, its dependencies,
a schema sketch, the decisions that were forced, and its open questions.

**Convention: a new idea = a new doc in `docs/ideas/` + a row here, in the same commit.** A row
without a doc is a reminder; a doc without a row is invisible.

Every doc below is an *idea* — nothing is implemented unless its own status line says otherwise
(`quick-wins.md` is findings, `web-architecture.md` is a behaviour-preserving refactor).

Order is dependency order, not importance: **7 of the 13 hang off `multi-team.md`**, which is why it
sits at the top.

| Idea | What it is | Depends on |
| --- | --- | --- |
| [multi-team](ideas/multi-team.md) | One team per captain instead of one team per server: team as tenant, `membership` rows instead of role/status on the global user, plus the defences against tenant leakage. | — |
| [player-profiles](ideas/player-profiles.md) | Players own their own profile (display name, Riot accounts with one main, preferred role, birthday); the captain owns the roster entry. Splits the row so edits propagate by construction. | multi-team |
| [hexserve-champion-data](ideas/hexserve-champion-data.md) | Champion names/icons and the patch come from the team's own Hexserve dump instead of Data Dragon — current patch plus one, German names, no third-party rate limit. | — |
| [availability-planner](ideas/availability-planner.md) | Everyone fills in when they can play; the team sees one merged summary of playable times and who would be missing, in wall clock, over a two-week window that nothing ever deletes from. | multi-team, player-profiles |
| [team-home](ideas/team-home.md) | The front page per team: patch, next playable window, next match, roster by role incl. sub and coach, next birthdays, tasks/goals, meeting topics, useful links. Read-only composition of the other features. | multi-team, player-profiles, availability-planner, matchdays, hexserve |
| [matchdays](ideas/matchdays.md) | Record Liga and scrim matchdays: opponent, BoN, per-game W/L + side + VOD, scouting from a pasted op.gg multisearch URL, Bilanz and head-to-head. Hand entry is the normal path — Riot usually cannot see these games. | multi-team, player-profiles |
| [match-history](ideas/match-history.md) | Hourly pull of every member's Riot games into a games list and champion stats — Riot-visible games only; fixtures and sides come from `matchdays`. | multi-team, player-profiles, hexserve |
| [champion-pools](ideas/champion-pools.md) | Each player curates main / situational / blind-pick pools in their own order; one team-wide blind-pickable list per role. | player-profiles, hexserve |
| [discord-digest](ideas/discord-digest.md) | One weekly Discord post per team via a webhook (no bot): playable window, who hasn't answered, fixtures, roster gaps. Exactly-once sending via a claim row. | team-home, availability-planner, matchdays |
| [realtime](ideas/realtime.md) | Edits appearing for everyone at once: Tier 0 (focus refetch, optimistic writes, one poll) vs SSE + an injected bus. Events are refetch hints, never state. | — |
| [logging](ideas/logging.md) | One line per request plus business events, to console and an NDJSON file, so "did it do the thing?" is answerable. | — |
| [web-architecture](ideas/web-architecture.md) | Behaviour-preserving refactor: get server state, mutations, derived rules and form state out of `RosterPage`/`AdminPage` into plain modules and hooks. | — |
| [quick-wins](ideas/quick-wins.md) | Findings from the module walkthrough: dead exports, a duplicate index, one-line inconsistencies, small extractions — cheapest first, each with its test rule. | — |

## Not written up yet

- **Google Sheets import** — bring the old sheet's roster and matches into Postgres (listed in the
  README as slice 1, no doc yet: the open question is what the old data is worth keeping).
