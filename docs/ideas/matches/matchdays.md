# Idea — matchdays: liga & scrim record-keeping (the "Liga" idea)

**Status:** idea, nothing implemented.
**Depends on:** `multi-team.md` (rows are team-scoped), `player-profiles.md` (`riot_account` and the
platform), `availability-planner.md` §3 (wall-clock time, reused verbatim here),
`team-home.md` §11 (the home page consumes the "next match"; §10 builders are reused for the
per-player links).
**Seam with:** `match-history.md` — §2 is the whole point of this doc. Read that first.
**Replaces:** the "Matches & Scouting" spreadsheet (one row per match, §1.2).

## 1. The idea

A page where the team records a **matchday**: a Liga or scrim fixture with an opponent, a date, a
series length, and then one row per game with W/L, side, VOD and notes. Plus the scouting half: paste
one op.gg multisearch URL and the enemy roster appears, with per-player op.gg/deeplol links, roles
assignable, sorted by role. Plus a running **Bilanz** (win/draw/loss per match type) and
**head-to-head** history against each opponent.

### 1.1 The flow

```text
New matchday:  type (Scrim | ACE League | Prime League | …) · opponent · date · time · BoN
               — created by ANY member, not just the captain (§12)
               paste op.gg multisearch URL   → accounts appear   ← the only clever part
               assign roles (Top/Jgl/Mid/Bot/Sup, then Subs, Coach) — human, see §6

During/after:  Games 1..N:  W/L · Blue/Red · VOD link · timestamp note   ← typed in by hand (§2.1)
               drop the drafter.lol series link
               one opponent note for the day

Later:         Bilanz per type · head-to-head vs that opponent · archive (frozen)
```

### 1.2 What the spreadsheet does today, and where it hurts

| Spreadsheet | This idea | Why it is better |
| --- | --- | --- |
| One row per match in a sheet, "MATCH WÄHLEN" dropdown | `match` rows, list page | no formula to break, no lookup via dropdown |
| `Ergebnis 2:0` typed next to `Games 3` | score **derived** from game rows (§4) | the two can never disagree |
| `Rolle` column pasted per account, in paste order | `position` + sorted render (§6) | order stops being data |
| Multisearch URL + 4 account columns + 4 role columns | one URL **parsed** into N enemy rows (§5) | no per-cell copy-paste, no typo'd tag |
| `OP.gg` / `DeepLoL` columns, hand-built per row | builders from the account (§8.1) | 5 players × 2 links = 10 cells of busywork gone |
| `Draft-Link (drafter.lol)` | stored verbatim + per-game rewrite (§8.2) | one field, still per-game clickable |
| Archive as "one row per match" | archive **view**, not a storage shape | one table, filterable |
| S/U/N per type, hand-computed | pure `summarize()` (§10) | 0-game division by zero handled once (§10.3) |

The spreadsheet is already the right *shape*: matchday → games, opponent roster, notes, stats. The
gain here is not a new concept, it is **derivation instead of transcription**.

## 2. The boundary: a matchday is a container, Riot games are optional contents

`match-history.md` builds a `match` table out of **Riot's** data (`match-v5`, `tournament-v5`):
participants, champions, KDA, lane opponents. This doc builds a matchday out of **what the people who
played it know**. Two features, one word, guaranteed confusion unless the seam is written down:

| | `match-history.md` | this doc |
| --- | --- | --- |
| Source | Riot API (automatic, hourly) | a human typing (§1.1) — the *only* source, §2.1 |
| Owns | participants, champions, KDA, lane matchups | opponent, schedule, series, result, sides, VODs, notes |
| Unit | one LoL game | one matchday (1–5+ games) |
| Cannot know | "that was a scrim vs. Anes" | the KDA of game 2 |
| Coverage | only games Riot exposes | **everything the team plays** |

### 2.1 Manual is the normal case, not a bridge until the import lands

This is the correction that governs the rest of the doc. **Most scrims and league games are not
trackable by Riot at all**: scrims run on tournament codes or in modes `match-v5` does not expose, and
league games run on the organiser's tournament codes, which `tournament-v5` can only resolve if we
hold the code. So:

- **The manual path is the product.** Opponent, series length, per-game W/L and side, VODs, notes —
  complete and useful with zero Riot data. If a Riot row ever exists, it adds KDA and champions and
  nothing the team needs to *plan or review*.
- **`match_game.riotMatchId` is optional enrichment, expected `NULL` for most rows, forever.** No
  "waiting for import" badge, no periodic job polling for a match that will never appear, no UI copy
  that makes a hand-entered matchday look provisional. `resultSource` exists only so the UI knows
  whether a result is editable (§4), not to mark manual rows as lesser.
- **Nothing may be *derived* from Riot as the primary path.** `result` and `side` are typed columns
  with `riot` as an override when a link exists — not a view over Riot data with a manual fallback.
  The reverse direction (derive from Riot, fall back to typed) makes the common case the exception in
  the code.
- **Nobody verifies these numbers.** The record is the team's own claim, so each game row carries
  `recordedBy` + `recordedAt` (§3). Not policing — it means a wrong score on the archive page has a
  person to ask. Cheapest audit trail available, and it costs two columns.

Two features, then, not one with a fallback: a matchday is a *fixture*, a `match-history` row is a
*game Riot happened to expose*. Neither is a superset of the other, which is why the link is worth
keeping and why this feature must not wait for it — **the manual path ships alone and stays alone.**

### 2.2 The overlap to resolve in `match-history.md`

That doc's §5.8 already hand-enters a whole match to cover scrims Riot cannot see. With matchdays,
that is a **second manual form for the same evening** — the reliable way to end up with half the
scrims in each table. Proposed split, to be decided there:

| | matchdays | match-history |
| --- | --- | --- |
| Fixture: who, when, BoN, opponent | **yes** | no |
| Result + side + VOD per game | **yes** | read from the link when present |
| Participants, champions, KDA | no | **yes** |
| Entry when Riot has nothing | **the only entry point** | should not exist |

So: `match-history`'s hand-entered match becomes "attach detail to an existing `match_game`", not a
parallel manual record. Decide it before either is built; it is a paragraph in a doc, not a
migration later.

## 3. Model sketch

```text
opponent        id, teamId → team, name, note?, createdAt
                UNIQUE (teamId, lower(name))        ← "Anes" and "anes " are one team

match           id, teamId → team, opponentId → opponent,
                type ∈ {scrim, ace_league, prime_league, other}, typeLabel?,   ← "other" needs a label
                playDate date, startMinute int,      ← wall clock, §7 — NOT a timestamp
                bestOf int CHECK (bestOf in (1,2,3,4,5,7)),
                status ∈ {scheduled, played, archived},
                multisearchUrl text?,                ← stored verbatim, §5
                draftUrl text?,
                note text?,                          ← this day's scouting note
                createdBy → user ON DELETE SET NULL, ← any member may create (§12)
                createdAt, updatedAt
                INDEX (teamId, playDate)

match_game      id, matchId → match, idx int,         ← 1..bestOf, UNIQUE (matchId, idx)
                result ∈ {win, loss} | NULL,         ← NULL = not recorded yet
                side ∈ {blue, red} | NULL,
                vodUrl text?, vodNote text?,         ← timestamps live here as text
                riotMatchId text?,                   ← match-history link when Riot can see it;
                                                       NULL for most rows, forever (§2.1)
                resultSource ∈ {manual, riot} default 'manual',
                recordedBy → user ON DELETE SET NULL, recordedAt   ← typed-in results have an owner (§2.1)

enemy_player    id, matchId → match, position ∈ ROLES | NULL, kind ∈ {player, sub, coach},
                gameName text?, tagLine text?,       ← NULL allowed only for coach (§6.1)
                ignored boolean default false,       ← "this account isn't a player" (§5.4)
                CHECK (kind <> 'coach' OR position IS NULL)
                CHECK (kind =  coach OR (gameName IS NOT NULL AND tagLine IS NOT NULL))
```

- **No `score` column.** Not on `match`, not denormalized, not "for the list view" (§4).
- `opponent` is a row, not a string: "view past matches against another team" is then a `WHERE`, and
  the name is typed once. Upserted by name in the UI, so creating an opponent is still zero extra
  steps.
- `enemy_player` is **per match**, not per opponent: rosters change between weeks, and a matchday's
  scouting must reflect who actually played. Knowledge that outlives a match belongs on
  `opponent.note` (§9).
- `createdBy` / `recordedBy` are **set-null, not cascade**: a person leaving must not take a
  matchday and its VODs with them (§12).
- `type` is an enum + `typeLabel`: leagues come and go (ACE, Prime, a one-off cup). Adding an enum
  value is a migration; adding a label is a form field. Enumerating the two big ones plus a labeled
  escape hatch is the honest 80%.

## 4. Score and outcome are derived — three pure functions

This is the rule that keeps the spreadsheet's worst failure mode out of the app: `Ergebnis 2:0`
typed by hand while `Games` says 3.

```text
deriveScore(games)     → { wins, losses, draws: impossible, played }        // count, no storage
deriveOutcome(games)   → 'win' | 'draw' | 'loss' | 'incomplete'            // for Bilanz
isSeriesComplete(m, g) → wins >= ceil(bestOf/2) || played == bestOf
```

- **`draw` is real**: the sheet's `S · U · N` (Sieg/Unentschieden/Niederlage) is not decoration — a
  Bo2 can end 1:1, and some leagues use Bo2. So `bestOf` includes `2`, and equal game wins is a draw.
  A Bo3 can never draw; the equality branch is still the correct general rule.
- `incomplete` is not a bug state: a scheduled matchday has zero games, a live one has two of three.
  Bilanz must not count those (§10.2).
- Fewer games than `bestOf` is legal (aborted series, opponent forfeits, bestOf typo). Never force a
  full set of rows; `idx` is contiguous from 1 but may stop early.
- Keep `result NULL` distinct from "no row yet": a row exists as soon as the matchday is created
  (that is what renders the Games table), and its `result` is filled at play time.

**The wrong turn to avoid:** storing `match.score` "just for the list page". The list needs the score,
so someone will denormalize it, and then a corrected game row leaves a stale score on the archive
page. Derive it in the query (a `group by` with `count(*) filter`) or in the pure function; the list
is at most a few hundred rows per team.

## 5. The multisearch import (the one clever part)

Input: the URL a member already pastes into the spreadsheet.

```text
https://op.gg/de/lol/multisearch/euw2?summoners=Chimmi+Changa%23POA%2CEkstase%237575%
2CJeremylord%23lord%2CKhalid+Kashmir%23187%2CSamuRat%23G314
```

Output: five accounts, no roles (the link does not carry roles):

```text
Chimmi Changa#POA · Ekstase#7575 · Jeremylord#lord · Khalid Kashmir#187 · SamuRat#G314
```

### 5.1 Parse for structure, store for fidelity

Two rules, and the second one is the one people skip:

1. **Parse** the URL into `{ gameName, tagLine }[]` — that is what makes per-player links and roles
   possible.
2. **Store the pasted string verbatim** as `match.multisearchUrl`, and render "Multisearch öffnen"
   from that stored string, **not** from a re-built URL.

Rule 2 matters because a re-built URL is a *guess* about a third party's format. Their locale prefix
(`/de/`), their shard segment (`euw2`), their separators — get one of them wrong and the team's
most-used link is subtly broken, on a server, five minutes before the game. The pasted URL works by
definition. Structure is for *us*, fidelity is for *them*.

### 5.2 The parser is pure and shared

```text
packages/shared/src/multisearch.ts
  parseMultisearch(url) → { platformHint: string | null,
                            accounts: { gameName, tagLine }[],
                            warnings: string[] } | { error }
```

- Lives in `packages/shared` so the SPA can preview the import instantly while typing/pasting, and
  the API runs the *same* function on save. One implementation, two call sites.
- Pure → the nastiest string-handling in this feature becomes a table-driven unit test (§15).
- Encoding is the whole difficulty and the reason to not hand-roll it per site: the sheet's URL mixes
  `+` for spaces and `%23` for `#` and `%2C` for the comma separator. Decode `+` → space **before**
  `decodeURIComponent` (form encoding), split the `summoners` param on `,`, drop empties, cap at ~10.
- **`warnings`, not silent repair**, for: fewer than 5 accounts, more than 8, an entry without a tag,
  duplicates, and — important — a **raw `#` in the pasted string**. In a URL, `#` starts the fragment:
  everything after it is never sent to the server and is dropped by many clients. A "link" copied
  from somewhere that left `#` unencoded may already be truncated; say so instead of importing four
  players and one mystery.
- `platformHint` comes from that `euw2` segment and is a **hint only**: `euw2` is not `euw1`, and
  guessing a platform wrong produces ten broken links. The match carries a real `platform` (default:
  the team's, from `player-profiles.md` §3), and the hint may only *inform* an "is this right?" label.

### 5.3 Import is a draft, never a commit

Paste → a **preview list** → confirm → rows are written. Reasons, both real:

- the URL format is third-party and will change; a silent auto-import on a changed format means an
  empty or wrong enemy roster discovered mid-draft;
- the people in the link are not necessarily the people who will play (subs, a coach, a
  account that the opponent's own member list forgot).

Re-pasting a new URL for the same match: diff against the existing rows (same `gameName#tagLine` →
keep the manually assigned role and links), add the new ones, and **never delete silently** — an
account that vanished from the link gets `ignored = true` instead, so its per-player VOD/role notes
survive an opponent fixing a typo in their list.

### 5.4 "That account isn't a player"

`ignored` exists because the multisearch link is a list of *summoners*, and a coach's account or a
smurf in the link is noise in a scouting view. One click hides it without losing the row.

## 6. Enemy roles: assignable, ordered, two axes

The link carries no roles — and roles genuinely cannot be inferred from a Riot ID. So:

- import creates N rows with `position = NULL`, `kind = 'player'`;
- the UI asks for roles: five slot selects (Top/Jgl/Mid/Bot/Sup) plus the overflow rows, which get
  `kind = 'sub'` (with their own `position`) or `kind = 'coach'`;
- **render order is `ROLES` order, then unassigned, then subs, then coach** — never insertion order,
  never paste order. That is the sheet's own lesson: the scouting panel is sorted, the archive row is
  in paste order, and only one of them is readable.

Reuse, don't re-derive: `ROLES` is already domain order (`packages/shared/src/index.ts:1`) and
`team-home.md` §7 introduces exactly this `position` + `kind` pair for our own roster. Same shape on
both sides of the match means one table component, one sort helper, one `CHECK` convention. If the
enemy side gets its own flat `SUB`/`COACH` enum, the two halves drift.

### 6.1 A coach may have no account

The sheet has a `Coach (falls nicht im Link)` column — the coach is usually not in the multisearch
list, and sometimes has no Riot ID at all. Hence the nullable `gameName/tagLine` for
`kind = 'coach'` (and the `CHECK` that forbids it for players): a manual "Coach: name" row is legal,
a player row without a Riot ID is not — otherwise the per-player links (§8.1) have nothing to build
from and render dead.

### 6.2 Later, an *assisted* role guess (not v1)

Riot's `match-v5` participant carries `teamPosition` per game, so sampling an enemy account's last
~20 games gives a strong role hint. Costs: resolve `puuid` per enemy (3 calls), then N match calls per
enemy, against a 100-req/2min dev key (`player-profiles.md` §4). That is a *poor* deal for a
five-minute scrim setup, but a reasonable "Guess roles" button for a Liga opponent prepared a day
ahead. Design constraint if it ever happens: a **suggestion**, applied only on explicit click, and
never overwriting a role a human set. Roles set by a human are facts; inferred ones are guesses.

## 7. Time: wall clock, not an instant

`playDate date` + `startMinute int` (0–1440), rendered in `team.timezone` — the same model and the
same reasoning as `availability-planner.md` §3: "19:00 on the 17th" is a statement about local wall
clock. A UTC timestamp would drift by an hour across the DST switch, and matchdays are exactly the
rows people schedule weeks ahead across that switch.

Consequences to accept:

- Ordering "next match" is `(playDate, startMinute)` — a local tuple, not a global instant. Fine: all
  rows are in one team's zone by definition.
- The `CHECK (0 <= startMinute AND startMinute <= 1440)` mirrors the planner's constraint.
- The home page must not compare this to `Date.now()` in the browser's timezone. "Today" is the
  team's today (`team-home.md` §6 makes the same point for birthdays). One `teamNow()` helper, used
  by both.

## 8. Links: stored, derived, and honest about decay

### 8.1 Per-player op.gg / deeplol — builders

Same module and same rules as `team-home.md` §10: pure `build(ctx) → url`, `encodeURIComponent` on
the Riot ID, `target="_blank" rel="noopener noreferrer"`, and **verify each site's current URL shape
before implementing** — third-party paths change without notice and the only defence is that a URL is
written in exactly one place.

The per-player link needs `platform` + `gameName#tagLine`. Both come from the parsed account and the
match's platform. An enemy row without an account (coach) renders no link, not a broken one.

### 8.2 The drafter.lol series link

The sheet stores one series URL with `?game=1` and links each game from it. Two shapes are possible
and only one is honest:

- store **one** `draftUrl` per match, verbatim, and render "Draft öffnen" from it;
- per-game deep links only if the stored URL has a `game` parameter we can *safely* rewrite
  (`setSearchParam`-style, keeping every other param). If it does not, render the series link for
  every game and stop pretending.

Also: drafter.lol drafts are third-party artifacts that can expire or be deleted. So the draft link is
a **convenience**, never the evidence. The evidence is the VOD (§8.3) and the note. Do not build a UI
that implies otherwise.

### 8.3 VOD and timestamps

Per game: `vodUrl` + `vodNote` free text ("19:42 first blood, 28:10 Baron throw"). The sheet's
timestamps are free text and that is the right level of structure — a structured timeline is
`match-history`'s eventual business, not this table's.

Optional cheap win: a pure `withTimestamp(url, seconds)` that appends `?t=` for YouTube links, so
"watch this moment" is one tap. If it is not obviously a supported host, return the URL unchanged —
never mangle a link to be clever.

## 9. Notes: two scopes, one rule

The sheet has "Allgemeine Notizen zum Gegner" on the match *and* a notes column in the archive. Both
are used for the same thing, so knowledge ends up on whichever row happened to be open.

- `opponent.note` — **accumulating knowledge** ("their jungler always level-2 ganks bot", "they first-pick
  Rell"). Lives with the opponent, so it is there the *next* time, which is the entire point of
  scouting.
- `match.note` — **this day only** ("sub toplaner, no comms"). Rendered on the matchday, shown in the
  head-to-head view (§11).

Default the UI to `opponent.note`: it is the one that pays off. A per-match note is a footnote.

## 10. Bilanz (the numbers)

```text
summarize(matches) → per type: {
  matches: { win, draw, loss, unplayed },
  games:   { win, loss, played },
  gameWinrate: number | null,     ← null, not 0, when played = 0
}
```

### 10.1 Matches and games are different numbers

The sheet shows both and must keep showing both: `1 S · 0 U · 0 N (Matches)` next to
`Games 2 : 1 · 67 % Winrate`. A 2:0 and a 2:1 are one match win each but different game records. A
single "% winrate" is ambiguous — label it (it is the **games** winrate in the sheet).

### 10.2 Segregate by type, and excise the unplayed

- Scrim, ACE League, Prime League are three different currencies (a scrim win is not a league win).
  Never one combined number on the page — the sheet gets this right.
- `status = 'scheduled'` and `result = NULL` games are **not losses**. Counting them as losses is the
  most likely stats bug in the whole feature; the sheet avoids it only because nobody types the row
  before playing.

### 10.3 Zero games is `null`, not `0 %`

`0/0` must render as "—". `Math.round(x)` happens once, at render, on an already-final ratio — the
sheet's `67 %` is `round(2/3 * 100)`, and a stored rounded percentage would drift as games are added.

### 10.4 The time range is a decision, not a default

An all-time Bilanz becomes meaningless by month three. Options: a `season`/`split` string on `match`,
or a date-range filter with a sensible default ("this split"). Recommendation: a date range computed
from `playDate` (default: last 90 days, plus "all" toggle) and **no season column** — a season model
is a scheduling feature wearing a statistics hat. Confirm before implementing, because it changes the
query, not just the UI.

## 11. Past matches against the same opponent

A `WHERE opponentId = ?` and the same `summarize()`:

- head-to-head record (matches + games) at the top,
- the opponent's accumulating note (§9),
- the matchdays newest-first, each with its score, draft link, VOD count and per-game rows.

That is the "review games against this team" use case, and it is the reason `opponent` is a table
(§3) and the reason notes are scoped to it: this page is worth nothing if it is a list of links with
no memory.

## 12. Permissions: everyone plays, everyone records, everyone plans

The captain is not the team's scheduler. Whoever arranged the scrim creates the matchday, and
whoever is in the lobby records the result — so `member` is the guard for both:

| Action | Who |
| --- | --- |
| **Create a matchday** (type, opponent, date, time, BoN) | **any member** — the fixture is team work, not an admin task |
| Edit metadata, names, scouting URLs, notes, enemy roles | any member |
| Record a game result / side / VOD / note | any member — this happens at 23:40 on a phone; a captain-only guard means it never gets recorded |
| **Delete** a matchday | creator or captain — deletion takes VODs and the enemy roster with it |
| Archive / unarchive | creator or captain |
| Edit an archived matchday | captain, explicit "unlock" |

Why the split at *destructive* rather than at *create*: adding is cheap to undo (delete your own row),
and deleting a three-game scrim with VOD links is not. So creation is open and deletion is owned.
This is the same shape as topics in `team-home.md` §9 (anyone adds, own/captain deletes) — one
permission idiom in the product, not two.

Every write goes through `teamId` from the session's membership, never from the body — the tenant-leak
test from `multi-team.md` §5 applies to every endpoint here, and a match id from another team must
404, not 403 (do not confirm existence).

Consequences of multiple writers, all cheap if handled once:

- **Opponent names must be normalized** (`UNIQUE (teamId, lower(name))`, §3) — two people creating a
  matchday against "Anes" in the same evening is the expected case, not the edge case.
- **Two people adding "Game 3" at the same time** collide on `UNIQUE (matchId, idx)`; the loser gets a
  409 and reloads. That is the desired outcome — no client-side coordination needed.
- **Last write wins for notes and results**, with `updatedAt` rendered as "last edited by…". A
  conflict dialog for a six-person team is more friction than the conflict.
- **Show who created the matchday** in the header next to the date. It answers "did anyone already
  set this up?", which is now a question nobody can answer by looking at a captain-only list.

## 13. What the home page consumes

Delivers `team-home.md` §11 exactly:

```text
next: { startsAt (wall clock + tz), opponent, competition: type, bestOf, url }
last: { opponent, score, outcome }      ← when nothing is scheduled
```

One loader, two rows. No participant stats, no chips — that is `match-history`'s page. If the home
card ever needs a champion icon, the boundary in §2 has been crossed.

Archive freshness: "next" means `status <> 'archived'` and `(playDate, startMinute) >= teamNow()`.
A matchday whose time has passed but which is not yet archived still counts as "next" for the rest of
that evening — a 19:00 scrim at 21:00 is the one you are currently playing, and it is the card you
want, not "nothing scheduled".

## 14. Routes and pages

All routes: `{ teamMember: true }`. Delete and archive additionally require creator-or-captain
(§12) — that rule lives in a plain function, not inline in the handler.

```text
GET    /api/teams/:teamId/matches?type=&from=&to=      list (archive view)
POST   /api/teams/:teamId/matches                     create matchday — ANY member (§12)
GET    /api/matches/:matchId                          matchday + games + enemy players
PATCH  /api/matches/:matchId                          metadata, notes, URLs, archive
POST   /api/matches/:matchId/games                    add the next game row
PATCH  /api/matches/:matchId/games/:gameId            result / side / vod / note
POST   /api/matches/:matchId/enemy-players/import     { multisearchUrl } → diff, draft rows (§5.3)
PATCH  /api/matches/:matchId/enemy-players/:id        role / kind / ignored
GET    /api/teams/:teamId/opponents/:id               head-to-head (§11)
POST   /api/teams/:teamId/opponents                   upsert by name (§3)
```

SPA: `/matches` (list + Bilanz), `/matches/:id` (the matchday, two columns like the sheet: scouting
left, games right), `/opponents/:id` (head-to-head). Home links into `/matches/:id`.

## 15. Testing

Pure modules first, one integration test per seam — no exceptions, and this feature has an unusually
high pure-function ratio, so this is cheap:

- `parseMultisearch` — **use the real pasted strings as fixtures**, including the §5 one with `+`,
  `%23` and `%2C`; plus: no `summoners` param, empty entries, trailing comma, 4 accounts (warn), 9
  accounts (warn), an entry without `#tag`, a duplicate, a raw `#` in the string (§5.2).
- `deriveScore` / `deriveOutcome` / `isSeriesComplete` — 0 games, 1 of 3, 2:1, 2:0 in a Bo3, the 1:1
  Bo2 draw, more wins than `ceil(bestOf/2)` (bestOf edited down after the fact).
- `summarize` — `null` winrate at zero games, unplayed matches not counted (§10.2), per-type
  segregation, rounding once.
- `sortEnemyPlayers` — ROLES order, unassigned last, subs after players, coach last, stable for equal
  keys.
- `buildEnemyProfileLinks` — spaces and `#` encoded, coach with no account yields no link.
- `withTimestamp` — supported host appends `t=`, unsupported returns unchanged, existing query kept.
- Guards — 401 unauthenticated; 403 for a member of another team; 200 for a member. Specifically:
  a **plain member creates a matchday** and records a game (§12); a member deleting *someone else's*
  matchday → 403, the captain doing it → 200, the creator doing it → 200; a `matchId` belonging to
  another team → 404, never 403 (do not confirm existence).
- Concurrency — a second `POST …/games` for an index that already exists returns 409, does not
  create two "Game 3" rows (§12).
- A manually recorded result round-trips: create matchday → add games → `deriveScore` matches what
  the UI shows, with `riotMatchId = NULL` throughout (§2.1 — the *only* path that must work).
- One integration test for the import diff: paste, assign roles, re-paste with one account renamed
  and one removed → the old row survives with `ignored = true`, the manual role is preserved (§5.3).

## 16. Naming

- **`matchday`** in prose and UI, `match` in the schema (it is the fixture; `match_game` is a game).
  Avoid `series` for the container — `bestOf` already means "series length" (of games).
- `side` is `blue`/`red`, not `100`/`200` (Riot's team ids belong in the mapper, not the column).
- `result` is `win`/`loss` (games cannot draw); `outcome` is `win`/`draw`/`loss` (matches can).
  Two words, deliberately different — a shared `result` that sometimes means "game" and sometimes
  "series" is how the 2:1 / 3-games mismatch gets rebuilt in code.
- German vs English: the UI may say `S / U / N`, the code says `win / draw / loss`. Never the
  reverse — an enum with `U` in it is unreadable to the next reader and unsearchable.

## 17. Open questions

1. **Stats time range** — date range (recommended, §10.4) or an explicit `season` field? Decide before
   the Bilanz query is written.
2. **"Other" match types**: a free-text `typeLabel` next to the enum, or named types per team that
   anyone can add? Enum + label is cheaper; a real table is cleaner if they play many cups.
3. **Scrim opponents without a multisearch link**: fine — accounts can be added by hand. Should the
   importer also accept a plain list of `Name#TAG` (no URL), which is what people have after asking
   in Discord? Cheap to add, likely worth it.
4. **Bo4?** `bestOf` allows 1/2/3/5/7 now. Some formats play 4. If it comes up, `CHECK` is a
   one-line migration — but the draw rule (§4) already handles it, so this is only a constraint change.
5. **Delete/archive: creator-or-captain (proposed §12), or truly everyone?** A six-person team of
   friends may not care about ownership at all — cheaper rule, and the archive is one click back. The
   argument for creator-or-captain is only that deletion is the one irreversible action here.
6. **Who creates the *Liga* matchday** when the league announces the date? Any member is fine, but
   should that first row be flagged "official" (from the league site) versus "planned by us"? Only
   matters if you want a reminder that a date is still tentative.
7. **Screenshot attachments** (post-game lobby, Prime League match page) — currently only links. An
   upload path needs storage, quotas and deletion; that is its own decision, and links are honest
   until then. Note this matters *more* now that Riot cannot back up most results (§2.1): for an
   untrackable game the screenshot is the only independent evidence, and we only store its URL.
8. **Do we ever want the enemy's picked champions per game?** That is `match-history` data if Riot can
   see the game, and hand-typing five champions per game will not happen. Assume no.
9. **Does the drafter.lol link need to survive the third party dying?** If a season's drafts matter
   long-term, the answer is "store the pick/ban text at archive time", which is a real feature and
   should not be smuggled into this one.
