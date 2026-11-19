# Idea — the team home page (first thing you see)

**Status:** idea, nothing implemented.
**Depends on:** `multi-team.md` (a page per team, and the team switcher that opens it),
`player-profiles.md` (birthday lives on the profile), `availability-planner.md` (the playable
window), `hexserve-champion-data.md` (patch), `matchdays.md` (the next Liga match / scrim).
**Introduces:** `profile.birthday` (§6), tasks/goals (§8), meeting topics (§9), the useful-links
catalogue (§10).

## 1. The idea

Opening a team lands on a **home page**, not on the roster. One screen that answers, in this order:

1. *Am I playing tonight?* → current patch, next playable window
2. *Who are we?* → roster by role, including subs and coach
3. *What's the plan?* → next tasks (yours and the team's), open topics for the next meeting
4. *Anything personal today?* → next birthday
5. *I need a tool* → the links row (u.gg, op.gg, deeplol, drafter, …)

The team **name** is the page title, plus the patch, so the header alone answers "where am I and
which patch is this".

`/` currently redirects to `/roster` (`apps/web/src/App.tsx:14`). The home page takes `/`; the
redirect disappears. `/roster` stays as the editable full table.

## 2. What this page is *not*

A dashboard is where features go to be duplicated. The one rule that keeps this honest:

> **Every block is a read-only composition of another feature's summary.**
> If a block needs a filter, a sort, an edit form or a scrollbar, it belongs on its own page.

Concretely not on the home page: champion pools, match history, full availability grid, member
admin, chat. Each block shows **the single next thing** and links to the feature behind it.

Corollary: the home page must **import** the availability summary from the planner, not
re-implement the merge. Two implementations of "when can we play" will disagree, and the home page
will be the one people trust.

## 3. Shape: one endpoint, many pure builders

Eight widget queries from the SPA is eight loading spinners and eight failure modes. One endpoint:

```text
GET /api/teams/:teamId/home        guard { teamMember: true }
→ {
    team:     { id, name, slug },
    patch:    { version, releasedAt, source } | null,
    window:   { candidates: [...], answered: 3, total: 5, windowStart } | null,
    match:    { startsAt, opponent, competition } | null,
    roster:   [{ position, players: [...], sub: [...] }],  coach: [...],
    birthdays:[{ profileId, displayName, month, day, daysUntil }],
    tasks:    { mine: [...], team: [...] },
    topics:   [...],
    links:    [...]
  }
```

Assembled from per-section functions, each independently guarded:

```text
apps/api/src/home/summary.ts    buildHomeSummary({ team, roster, window, ... })  ← pure, unit-tested
apps/api/src/home/sections/*.ts  loadPatch(), loadWindow(), loadRoster(), …      ← one query each
```

- **One query per section, no N+1.** Roster is one join; birthdays are one read; links are code.
- **A failing section degrades, it does not 500 the page.** Each section catches and returns
  `null` + a flag; the page shows "not available right now" in that card. A dead Riot call must not
  hide the roster.
- **Never cached across users.** The response contains "my tasks" and birthday visibility, so a
  shared cache key would leak one member's view to another. Cache per `(teamId, userId)` or not at
  all (v1: not at all — it is one cheap request).
- Why a pure `buildHomeSummary`: the interesting rules (ordering, "is the roster complete", "which
  task is next", "whose birthday is nearest") are exactly the untestable-in-a-route kind. Same
  argument as `missing-link`, `api-result.ts` and the rest of `web-architecture.md`.

### Why not "each widget fetches its own thing"

The one real argument for it is independent refresh. It loses: this page is opened cold, on a
phone, before a scrim. One round trip, one skeleton, one error path wins over eight.

## 4. Current patch

Two different things get called "current patch" and they will drift:

| Thing | Source | Use |
| --- | --- | --- |
| **Live game patch** (e.g. `25.03`) | Riot / external | "what the game is on" |
| **Hexserve dump version** | our own `hexserve` ingest | "which data our champion pages show" |

Recommendation: display the **live** patch (that is what the team cares about) and, if it differs
from the Hexserve dump, say so — "patch 25.03 · data from 25.02". Divergence is a *feature*: it tells
you the dump needs a refresh, which is otherwise invisible.

- Store it, don't derive it per request: a one-row-per-patch `patch` table with
  `version, releasedAt, source`, latest wins. A scraper or a manual captain edit both write there.
- Render with an "as of" date. A patch number without a date rots silently.
- `null` is a valid state and must render as "unknown", not "patch 0".

## 5. Next playable window

The planner already computes candidates ("when can at least 4 of us play"). The home page shows the
**top 1–3**, plus `answered 3/5` when someone hasn't filled in theirs:

- Same pure function as the planner page, different slice. If the planner does not expose one yet,
  extract it there *first*, then call it here — not the other way round.
- "Next playable window" means **the earliest candidate at or after now, in team time**. Not "the
  next row of the table".
- Empty is a normal, useful answer: *"Nobody has answered this week"* with a link to the planner,
  which is a nudge, not an error.

## 6. Birthdays

This is the only new *personal* data on the page, so it gets the most care.

### The field

`profile.birthday date NULL` — optional, self-owned (`{ auth: true }` route, per
`player-profiles.md` §2), editable at any time, **never required**. Asked on the onboarding screen
with a "skip" link and a one-line explanation of who can see it.

### The year is the problem

A birthday needs day+month to be useful and *nothing else*. The year is pure liability:

- it is a real PII delta on a roster app;
- it invites "how old is X", which is not this product's business;
- and the classic leak is the API returning `1999-04-12` while the UI hides it — the value is in the
  network tab and in any export.

So: **store the full date (people do state it), never return the year.** The DTO is
`{ month, day, daysUntil }` and the birthday table has no column the API is allowed to select into a
response. If an age is ever wanted, it becomes an explicit per-profile opt-in field, decided later.

### "Next" is an ordinal comparison, not a timestamp diff

```text
daysUntil = (next occurrence of (month, day) in team timezone) − today   // 0…366
```

Cases that must be pinned by tests, because each one is a different off-by-one:

- **today** → `0` → "today 🎂" (nice touch, cheap)
- **yesterday** → `365`, not `-1` (wraps to next year)
- **29 February** in a non-leap year → decide: 28 Feb or 1 Mar. Pick one, write it down, test it.
- **timezone**: "today" is the *team's* today (the planner already has `team.timezone`), not the
  server's UTC day. Two hours of UTC skew is a whole day of wrong greeting.
- **no birthday set** → not in the list at all; a team where nobody answered shows an empty card,
  not eight placeholders.
- **inactive / left members** → excluded.

Show **the next one** (maybe three). A "birthdays" wall of 12 is a data table, not a greeting.

Visibility: teammates only (`teamMember` guard). Pending users see nothing — they are not in the team
yet.

## 7. Roster by role — and the `SUB` trap

Requested: "quick overview of the current roster for each role, sub and coach".

The obvious move is to extend `ROLES` with `SUB` and `COACH`. **Don't.** A sub is not a sixth
position, it is a *kind* of roster entry that still has a lane — ask "which lane does this sub cover?"
and a flat enum has nowhere to put the answer. Same hazard `player-profiles.md` §8 already flagged
for `player.role` vs `user.role`.

Two axes, two fields:

```text
roster_entry   …, position ∈ {TOP,JGL,MID,ADC,SUP} | NULL,   kind ∈ {player, sub, coach}
```

- `kind = coach` → `position` must be `NULL`
- `kind = player | sub` → `position` required
- enforce with a `CHECK`, so the invalid row cannot exist rather than being "handled in the UI".

Home renders five rows by `ROLES` order (already the domain order — use it, don't re-type it, cf.
`quick-wins.md` B2), each starter plus its subs, then a coach row.

**A gap is the point.** An empty MID row should read "MID — open", not vanish. The overview exists
to show the hole, and "the roster is not complete" is a real team fact. Feeding the same computation
into the onboarding checklist (§13) means one rule, two surfaces.

## 8. Tasks and goals

Two things the request half-merges; keep them apart:

| | `goal` | `task` |
| --- | --- | --- |
| Lifetime | weeks–months | days |
| Count | 1–3 per team | many |
| Owner | the team | a person *or* the team |
| Home page shows | the current goal, pinned | the next 2–3 per owner |

```text
goal    id, teamId → team, title, detail?, targetDate?, createdBy, createdAt, achievedAt?
task    id, teamId → team, assigneeId → user | NULL   (NULL = team task),
        title, dueAt?, doneAt?, createdBy, createdAt, position?  ← manual order within an owner
```

- Deliberately no comments, no labels, no priority field, no status beyond open/done. The moment it
  needs those, it is an issue tracker and should not be built here.
- "Next task" = earliest `dueAt` where `doneAt IS NULL`, `dueAt IS NULL` sorts last. Undated tasks
  are not "overdue", they are just "someday" — do not paint them red.
- `assigneeId → user` (not `rosterEntry`): tasks follow the **person**, and survive leaving the
  roster. Someone who leaves gets their open tasks shown to the captain to reassign.
- Everyone can create a task assigned to themselves; only the captain creates team tasks or assigns
  someone else. Same shape as the members/invites rules already in `lib/access.ts`.

`position` (manual order) is the small luxury: people will drag the list and expect it to stay.

## 9. Topics for the next meeting / scrim

A shared, append-only list everyone can see and everyone can add to. The design question is *what a
topic belongs to*, and "next meeting" is the trap: a `meeting` entity means a whole scheduling
feature, and the list would be empty until someone creates one.

v1, deliberately flat:

```text
topic   id, teamId → team, createdBy → user, text, createdAt,
        discussedAt?  ← NULL = open
```

- One open list per team. "Next meeting" is **a label the UI derives** from the next event
  (playable window or Liga match, §5/§11) — the table stays team-scoped and never needs a meeting
  row to exist.
- Everyone: create, and delete **their own**. Captain: delete any, and "clear discussed" archives
  the whole list at once (`discussedAt = now`).
- Ordering: creation order, oldest first — a topic list is a queue, and reordering it is how the
  loudest person wins.
- **No realtime.** Two members typing means refetch-on-focus / invalidate after your own write.
  WebSockets for a 5-person team's topic list is not the trade to make. Say this out loud in the
  code comment, or someone adds a socket.

Stretch (not v1): let the discussion happen here — a resolved topic keeps its resolution text.

## 10. Useful links — builders, not a hardcoded list

The tools named (u.gg, op.gg, deeplol, drafter, proviews, mobatrainer, dodgegame) are almost all
**parameterised**, and that is the whole feature: a dead link row is worthless, a pre-filled one
("our roster on op.gg multisearch", "this player's u.gg") is one tap.

So the unit is a function, not a string:

```text
packages/shared/src/links.ts
  linkDefs: [{ id, label, kind: 'team' | 'player' | 'none', build(ctx): string }]
  ctx = { teamName, accounts: RiotId[], player?: RiotId }
```

- Pure, no DOM, unit tested — an `encodeURIComponent` bug in a URL builder is invisible until someone
  clicks it on the phone, which is exactly the case a test catches and a human does not.
- **Verify every URL shape against the live site before implementing.** Third-party URL schemes
  change without notice and drop paths (`/summoner/` vs `/lol/summoner/`). The bound that matters is
  "the builder is the only place a URL is written", not a memorised format.
- `kind: 'team'` is the interesting one: op.gg multisearch (or equivalent) can take the whole
  starting five at once. That link belongs on the home page; the per-player links belong on the
  roster row and on the profile. `player` links with no account (free-typed, unverified) must be
  **omitted**, not rendered broken.
- Hardcoded definitions in code, not a DB table. Per-team custom links are a later feature with its
  own validation (a captain can otherwise put `javascript:` in a link — treat any future stored URL
  as hostile and allow only `https://`).
- Every external link: `target="_blank"` + `rel="noopener noreferrer"`.

## 11. The Liga match block

Now written up in `matchdays.md` (the "Liga" idea). What home needs from it is fixed here so the
block never has to be redesigned:

```text
{ startsAt, opponent, competition, isHome?, result? }   — only the next one, ordered by startsAt
```

- It renders **next**, not history. Results belong to the match-history page.
- If no match is scheduled, the card shows the last one's result instead ("last: 2–0 vs X") rather
  than nothing. An empty planning slot is better filled with a past fact.
- The date must be rendered in team time and named ("Tue 21:00"). A bare ISO timestamp on a home
  page is a bug report waiting to happen.

## 12. Ordering and layout

Order is a decision, not a preference, and follows the questions in §1 — a player opening this
before a scrim needs "am I playing" above the fold, a captain needs the gaps.

```text
header     team name · patch · (team switcher, when teams exist)
row 1      next playable window      |  next Liga match
row 2      roster by role (5 rows + subs + coach)   ← the tallest block, full width
row 3      birthdays · goal
row 4      my tasks | team tasks
row 5      topics for the next meeting
footer     links row
```

Mobile first: single column, header and window first. Desktop: the two-up rows above. This page is
read on a phone in Discord voice, not on a 27" monitor.

## 13. Empty is the default state

A brand-new team has *no* data: no availability, no tasks, no topics, no birthdays. The home page is
therefore mostly an onboarding surface, and that should be designed as the primary case, not as the
"no data" edge case:

- roster gaps → "MID — open · invite someone" (links to `/admin` invites)
- no availability → "Nobody has answered this week" (links to the planner)
- no birthdays → no card at all (do not beg for a birthday)
- no tasks → the team goal is the seed: "set a goal for this split"

This is the same computation as §7's gaps reused as a checklist — one rule, two surfaces, and it
means the app's first impression is "here is what is missing", not "here is an empty table".

## 14. Testing

Per `AGENTS.md`: pure modules first, one integration test for the seam.

- `buildHomeSummary` — pure, fixture-driven: section ordering, roster gaps, "next task" selection
  (dated before undated, done excluded), empty-everything shape.
- `daysUntilBirthday(month, day, today, tz)` — the six cases in §6. This is the single most
  test-bug-prone function in the doc; it earns a table-driven test.
- Link builders — per `kind`, `encodeURIComponent` on names with spaces/`#`, omission for missing
  accounts.
- Patch divergence — live vs dump version renders both, same version renders one.
- `GET /api/teams/:teamId/home` — **guard first**: 401 unauthenticated, 403 for a member of another
  team (the tenant-leak test from `multi-team.md` §5), 200 for a member with the full shape.
- Section degradation — one loader throwing yields `null` for that section and a 200 overall.

## 15. Naming

- **"Home"**, not "dashboard" — dashboards imply charts and filters; this is a front page.
- `home` as the route and module name; `TeamHomePage` in the SPA.
- `kind` (player/sub/coach) beside `position` (TOP…SUP), never one enum for both (§7).
- `goal` vs `task` vs `topic` — three words, three tables, no overload (§8, §9).

## 16. Open questions

1. **Birthday year**: store-and-hide as recommended, or accept only `(month, day)` at the input?
   The second is stricter and simpler; it just means "no ages ever" is baked in, not merely policy.
2. **Who may see birthdays** — teammates only (assumed), or optional per profile ("show to team")?
3. **Patch source of truth**: scrape, captain-entered, or Riot's version endpoint? Who fixes it when
   it is stale?
4. **Does a `meeting` entity ever exist?** v1 says no (§9). If the team already schedules meetings
   elsewhere, a real entity may be the cheaper long-run shape — decide before topics ship, since
   `topic.meetingId` is a migration later.
5. **Goals**: one active goal, or several with one "current"? Assumed: several allowed, one pinned.
6. **Tasks**: does "team task" need an assignee at all, or is an assignee just a task with a person?
   (Current sketch: `assigneeId NULL` = team task. Simplest, but check it survives "two people
   share a task".)
7. **Are link definitions global or per team?** Global in code for v1 — but a team-specific Discord
   or calendar link is the obvious first custom entry.
8. **Widget order**: is §12 the right order for *your* team? It is the one thing here that is pure
   taste and worth prototyping before building.
