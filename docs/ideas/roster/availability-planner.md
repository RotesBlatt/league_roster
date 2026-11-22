# Idea — availability planner (the spreadsheet's week planner)

**Status:** in progress (2026-11-22) — the whole v1 loop is running: painted weeks with answers,
the merged provisional summary, standing times, the captain's skip/reset and opening a finished
week, and history. Still missing from this doc: the per-week "no practice" note (§12.11), an
unlock expiry (§12.4), and history deeper than four weeks in the UI (§12.5).
**Depends on:** `multi-team.md` (everything is team-scoped) and `player-profiles.md` (who a "member" is).

## 1. The idea

Each member fills in when they can play, per day, for the next two weeks. The team sees one merged
summary: when everyone is free, when it's playable, and who would be missing. You edit only your own
entries. The captain advances the window one week at a time; nothing is ever deleted.

The rules as stated:

- no entry for a day = **not available**
- an entry with only a start = available **until midnight**
- several intervals per day are allowed (`9-12` and `15-23`)
- summary visible to everyone, editable only for yourself
- the window **auto-advances** when a week ends → always exactly **2 weeks visible** (this + next)
- the captain can **skip ahead** manually, e.g. past a week nobody can play
- a week that left the view is still in the DB and **everyone can look at past weeks**
- only the captain can **restore** a week that was skipped by mistake
- every answer is **timestamped**, so the summary can name who has not answered yet
- the summary works **before everyone has answered**: it shows the times derivable from the answers
  so far, clearly marked as provisional
- a candidate time is worth showing from **4 available** (substitute included); below that it is
  ignored, not flagged
- availability is **painted on a 30-minute grid** (7 days × 48 cells), not typed as an interval
  list: drag to mark, drag across marked cells to clear (decided 2026-11-21, reverses §9 of the
  first draft)
- **regular slots**: a member can record standing times — "Tuesdays 20:00–23:00, every week" — and
  a week they have not answered yet starts from them (decided 2026-11-21, see §4b)

## 2. The two hard parts

Everything else here is CRUD. These two are where the bugs live:

1. **The time model** — what "9-12" means, and what "until midnight" is.
2. **The sliding window** — a manual, captain-driven 2-week view over data that is never deleted.

## 3. Time model

### Wall clock, not instants

Store **minutes from midnight in the team's timezone**, not UTC timestamps.

"I'm free 21:00–23:00 on Tuesday" is a statement about *local wall clock*. If it were stored as a UTC
instant, the DST switch would silently move everyone's availability by an hour — twice a year, in the
week the roster matters most. Wall clock is also what the user typed, so there is no conversion to get
wrong on the way in.

Consequence: the **team** carries a timezone (`Europe/Berlin`), and every render uses it. A member in
another timezone sees team time (v1); showing their local time too is a later nicety.

### Half-open intervals, and 1440

An interval is `[startMinute, endMinute)` with `0 ≤ start < end ≤ 1440`.

- `9-12` → `540 … 720`
- **"only a start" → `end = 1440`**, i.e. until midnight. Not `0`.

That last one is the trap: representing "until midnight" as `0` makes it either a zero-length
interval or a wrap to the start of the day, depending on which comparison you write. `1440` is an
exclusive end that sorts and compares correctly, and it makes `end - start` the true duration.

Enforce it in the DB: `CHECK (startMinute >= 0 AND endMinute <= 1440 AND endMinute > startMinute)`.

### Granularity

Store minutes; constrain the *input* to 30-minute steps (scrims start on the half hour). Storing
minutes means the granularity is a UI decision, not a migration.

### Overnight sessions

`23:00–02:00` is a real thing for a gaming team, and the model above forbids it (`end > start`).
v1: forbid it, and tell the user to add an entry on the next day. If it turns out to matter, the
model already allows `end > 1440` later — but decide deliberately, don't discover it.

## 4. Data model

```text
team          …, plannerStart (date, nullable)   ← captain's manual skip-ahead (§5)

week          id, teamId → team, startsOn (date, a Monday), createdBy → user,
              createdAt, unlockedAt (nullable)  ← captain opened a past week for editing
              UNIQUE (teamId, startsOn)         ← makes lazy creation idempotent

answer        id, weekId → week, userId → user, submittedAt
              UNIQUE (weekId, userId)           ← "I answered", including "nothing free"

availability  id, weekId → week, userId → user, dayOfWeek (0-6),
              startMinute, endMinute, createdAt, updatedAt
              CHECK (0 <= startMinute < endMinute <= 1440)
              CHECK (0 <= dayOfWeek <= 6)
```

- **`dayOfWeek` relative to `week.startsOn`**, not an absolute date. The week row already anchors the
  date; storing a date on every interval duplicates that anchor and lets the two drift.
- **Normalize on write, not on read.** When saving a day, merge overlapping/adjacent intervals for
  that user. Then the DB can never hold `9-12` and `10-13` for the same person, and the aggregation
  never has to dedupe. This kills the single most common bug in this feature (see §6).
- No unique constraint on `(weekId, userId, dayOfWeek)` — multiple intervals per day are the point.
- **A member's standing times live in their own table** (§4b), never in `week`/`availability`; a week
  is the record of what was actually said about *that* week.
- **`answer` is a separate row from `availability`, and that is what makes "hasn't answered"
  expressible.** Someone who is free *nowhere* this week has zero availability rows either way;
  without an `answer` row, "I answered: nothing" and "I forgot" are indistinguishable. One extra
  row per member per week, and the captain gets a chase list.

### 4b. Regular slots — a template, copied at answer time

"Tuesdays 20:00–23:00" is not an answer about a week; it is a standing habit. It gets its own table,
and the week keeps owning the truth:

```text
availability_template  id, teamId → team, userId → user, dayOfWeek (0-6),
                       startMinute, endMinute, createdAt, updatedAt
                       CHECK (0 <= dayOfWeek <= 6)
                       CHECK (0 <= startMinute < endMinute <= 1440)
```

- **Copy on answer, not live inheritance.** A week the member has not answered yet is *shown* with
  the template's cells as unsaved suggestions; the first save writes them into `availability` like
  any hand-painted cell. From then on the week is edited on its own. So a template edit affects
  future, unanswered weeks only — it never rewrites a past week, never changes a summary someone
  already acted on, and the aggregation (§6) reads exactly one table and never learns the template
  exists.
- **The `answer` row decides whether the template applies.** No `answer` row → suggestions; an
  `answer` row → whatever was saved, including "nothing free" (zero rows). That is what stops
  "I am free nowhere this week" from being silently refilled next visit, and it needs no extra flag.
- **No write on read.** The template is read into the initial grid state, not persisted by a GET;
  lazy week creation stays the only write a read can cause.
- **Per team, per user**, not on `profile`: two teams can have two schedules.
- **The captain never edits a member's template** — same rule as availability (§8). It is the
  person's own data, and a typo in it costs one week, not a permissions debate.
- **A template is not an answer** (§4): prefilled suggestions for someone who has not submitted do
  not enter the summary, which is exactly the "no answer contributes nothing" rule.
- **No overnight** (§3): same 1440 end, same refusal to cross the day boundary.

### Does `week` still need to be a table?

If the window is derived, `week` is a denormalized date range. Keep it anyway:

1. a home for per-week metadata that will be asked for soon ("no practice this week", a note);
2. a stable FK anchor for `availability`;
3. `UNIQUE (teamId, startsOn)` makes lazy creation idempotent.

Provision lazily — on the first **write** of a window week, `INSERT … ON CONFLICT DO NOTHING`. No
cron job, nothing to forget to run. A read provisions nothing: a GET that writes is the thing
§4b's template rule already forbids, and the same reasoning applies here (decided while
implementing — this sentence said "read or write" before).

## 5. The window (auto-advancing)

The window is a **pure function of today's date in the team's timezone**:

```text
windowStart = max(startOfWeek(today, teamTz), floor)   // Monday 00:00
visible     = [windowStart, windowStart + 7d]          // exactly two weeks
```

No scheduler, no cron. Every read computes it, so it is correct after downtime, after a deploy, and
across DST (it is wall clock in the team's zone). A week ends at Monday 00:00 team time and the
window slides by itself. `floor` is the captain's manual skip (§5 below), and it is what keeps the
two rules from fighting.

**This deletes both traps from the earlier draft:**

- the window can never show the past — it is derived from today;
- it can never hide the current week — the current week *is* the first half of the window.

### Skipping ahead (the captain's manual advance)

A dead week — nobody can play — should not cost the team a week of planning. So the captain can move
the window forward by hand, **and auto-advance keeps applying on top.** One nullable date on `team`
absorbs both rules:

```text
skip one week   → floor = windowStart + 7d      (from the EFFECTIVE start, not from today)
back one week   → floor = windowStart - 7d      (clamped to this week)
back to today   → floor = null
```

Why a date instead of an offset counter: **`max()` is self-healing.** Skip to W+1 on a Wednesday and
next Monday the calendar has caught up, so the skip quietly stops mattering — no reset job, and no
counter that would leave the team permanently one week ahead forever.

- The skip is **team state, not per-user** — it moves the window for everyone.
- Skipping over a week **that has data does not delete it**; it becomes history like any other past
  week. That falls straight out of §4's "never deleted".
- **Cap it.** Unbounded skipping is a foot-gun: someone jumps to 2027 and the team cannot get back.
  A guardrail of ~8 weeks plus an always-visible "back to this week" is enough.
- Skipping is a *visibility* action. "We are not practising this week" is a different statement —
  that is the per-week note/flag below, and both will be wanted.

### The past: three separate things, don't merge them

"Undo" hides three different needs that must not share one mechanism:

| Need | Who | Mechanism |
| --- | --- | --- |
| **Look at a past week** | everyone | history view — read-only, any week, window untouched |
| **Undo a skip** (window moved on by mistake) | captain | lower `floor` by one week, or null it. Capped by `max()`: you can always get back to *this* week, never before it |
| **Edit a finished week** ("I was free on Tuesday after all") | captain | `unlockedAt` — affects *writing*, never visibility |

Why not let "restore" pull a finished week back into the window? Because the window would then have
to be a pin, and a forgotten pin freezes the planner in the past — the exact failure the derived
window exists to prevent. History plus an unlock covers the need without reintroducing state that
can rot.

`unlockedAt` therefore gates editing only. Visibility is derived; never two mechanisms claiming the
same job.

## 6. The aggregation — the part worth testing hardest

Input: for one day, a list of `(userId, start, end)`. Output: coverage over time, then play windows.

```text
1. boundaries  = sorted unique {start, end} of all intervals
2. for each segment between consecutive boundaries:
       count = number of DISTINCT users whose interval covers it
3. merge adjacent segments with the same count
4. keep runs where count >= MIN_PLAYABLE (4), drop runs shorter than MIN_SESSION (e.g. 60 min)
5. rank: count desc, duration desc, start asc
```

Step 2's "distinct users" is the whole ballgame. Two intervals from the *same* person must count
once — otherwise one enthusiastic member makes the team look full. Normalizing on write (§4) makes
this structurally impossible, which is why that decision is in the data model and not in the
algorithm.

This is a **pure function**, and it is the most testable thing in the entire app:

```text
packages/shared/src/availability.ts
  mergeIntervals(intervals)              → normalized, sorted
  computeCoverage(intervals)             → [{ start, end, count }]
  findPlayWindows(coverage, opts)        → [{ start, end, count, missing: userId[] }]
```

No DB, no React, no HTTP. Unit tests with plain arrays — the same tier as `claimInvite`.

### Cases to pin before writing the implementation

- one person, two overlapping intervals → counts as **1**
- adjacent intervals from one person (`9-12`, `12-15`) → merged to `9-15`
- `end = 1440` ("until midnight") behaves like any other end
- exactly at a threshold (count `4` is "with substitute", not "full")
- nobody available → no windows, not an empty window
- a day with no entries at all → absent, and the summary must say so rather than render blank
- a window shorter than `MIN_SESSION` is dropped
- ties in ranking resolve deterministically (start asc)

### Provisional data (before everyone has answered)

The summary has to be useful from the first answer, not only when it is complete.

- `answered` = users with an `answer` row for that week; `unanswered` = the rest.
- Windows are computed from whatever answers exist. An unanswered person contributes nothing — which
  is just the "no entry = not available" rule, so the algorithm needs **no special case** at all.
- While `unanswered.length > 0`, the summary is labelled **provisional**: the times that work so far,
  plus the list of who is still missing.

**Why provisional windows are safe to show:** counts can only go *up* as answers arrive. Every answer
adds intervals; no answer contributes zero. So the set of minutes covered by
`count >= MIN_PLAYABLE` is monotonically non-decreasing — **a window you see now cannot vanish.** It
can only get longer, gain players, or merge with a neighbour.

That is a property test, not an example test: *adding an answer never reduces coverage at any minute.*

Honest caveat: window *identity* is not stable. Two windows can merge into one, and a newly arrived
answer can promote a different slot to the top of the ranking. So "never disappears" holds for
coverage and for the guarantee "≥4 people are free then", not for the shape of the list.

## 7. Thresholds

| Available | Meaning | Shown? |
| --- | --- | --- |
| 5+ | full team | yes — recommended |
| 4 | 4 + a substitute who is free | yes |
| 3 or fewer | not enough | **no — ignored, not rendered** |

Two consequences of "4 is enough, below that ignore":

- there is no "barely" tier to colour red — a slot with 3 is simply not a candidate. Fewer states in
  the UI and no argument about what amber means.
- `MIN_PLAYABLE = 4` is the single constant the algorithm and the UI share. Named once, in
  `packages/shared`, never a literal in a component.

One modelling question they raise: does the count include substitutes? "Playable with 4 (thinking
about substitutes)" implies the count is simply *available people*, and the roster/sub distinction
only matters for **who is missing** — which is why `findPlayWindows` returns `missing: userId[]`
rather than a number. The UI can then say "missing: Anna (main), Ben (sub)".

## 8. Permissions

| Action | Guard |
| --- | --- |
| read the summary + everyone's entries | `member` |
| read a past week (history) | `member` — any Monday's week |
| write your own availability | `member` + `userId === me.id` |
| write someone else's | nobody — 403, not even a captain (§11.1) |
| skip the window / back to this week | `captain` |
| unlock a finished week for editing | `captain` |

The ownership check is the interesting one: it's the first route in this codebase where being a
member is not enough. It belongs in a plain function (`canEditAvailability(me, targetUserId)`), not
inline in the handler — same rule as `claimInvite`.

## 9. UI

- **Input:** one 30-minute grid you paint (below). It replaced the earlier "list of intervals"
  proposal: a week planner is a grid, and one drag beats three inputs per interval.

### 9.1 The grid

7 rows × 48 columns, one cell = 30 minutes, cell `i` = `[30i, 30i+30)`. "Until midnight" is the last
cell, nothing special.

- **The first cell decides the gesture.** Landing on a free cell paints, landing on a filled cell
  erases, and the rest of the drag keeps that mode. No paint/erase switch to forget, and "clear
  that hour" needs no extra control.
- **Tap paints one cell.** A drag that never moved is a tap, so touch gets the same grid — there is
  no second editor to keep in sync.
- **One-step undo.** A bad drag can erase eight hours; the last gesture is revertible. One step, not
  a history stack.
- **Snap, then normalise.** The grid only ever emits 30-minute boundaries; the write path still
  merges adjacent/overlapping intervals (§4), so stored data cannot depend on which cells were
  dragged or in which order.
- **Same component, two sources.** The week editor and the regular-slot editor are the same grid:
  one starts from the week's saved rows, the other from the template.
- **The grid is not the summary.** It shows *what I said*; §6's coverage bar is a separate computed
  rendering, so a bug in the grid can never invent a playable window.
- **Summary:** per day, a horizontal coverage bar coloured by threshold, the recommended window
  called out, and the missing players listed.
- **Week navigation:** two weeks side by side (or tabs); captain-only "Skip ahead" and "Back to this
  week"; a history list below that every member can open.
- **Who has not answered, above the windows.** The chase list is the captain's most actionable
  information, so it belongs at the top of the summary — not behind a click.
- **Provisional marker.** While answers are missing, the windows render with a clear "4 of 8 answered
  — these times are provisional" label, so nobody treats a partial result as final.

## 10. Testing

| Layer | What |
| --- | --- |
| unit (`packages/shared`) | the three pure functions, all cases in §6, **plus the monotonicity property**: adding an answer never reduces coverage at any minute |
| unit (`apps/api`) | `canEditAvailability`; `resolveWindowStart(today, floor, tz)` — skip clamped forward, auto-advance overtakes a stale floor, reset returns to this week; the answered/unanswered split |
| integration | own-only edit (403 for someone else's), captain-only skip/reset/unlock, an `answer` row is written on submit, a skipped week's data survives and shows in history, `UNIQUE(teamId, startsOn)` keeps provisioning idempotent |
| web | summary at 5+, at 4, and **nothing rendered at 3**; the unanswered list; the provisional label; "only a start" → 1440 |
| web (plain module) | `availability-grid`: cell ↔ interval mapping both ways, first-cell decides paint vs erase for the whole gesture, a tap paints exactly one cell, undo restores the previous cell set |
| unit (`packages/shared`) | a template prefills like a hand edit: `[540,720)` twice becomes one interval, and a template with `end = 1440` merges with the last cell |
| integration | an answered week is never refilled from a changed template; a template edit does not touch past weeks |

## 11. What the build decided

The patch trail is the detail; these are the calls that went beyond the plan above, and the ones
that changed it:

- **Coverage merges only on equal people**, not on equal count (§6 step 3). `9-12: a` and
  `12-15: b` stay two segments; merging them would claim both are free all afternoon and then lie
  in `missing`.
- **A play window's `count` is the intersection**, not its best minute: everybody counted is free
  for the whole window, and anyone free for only part of it is named in `missing`. A run of playable
  coverage is split rather than overstating when the intersection would drop below 4.
- **`findPlayWindows` takes the roster** and requires it: "playable" is a statement about the team,
  so an empty roster offers nothing. `MIN_PLAYABLE` and `MIN_SESSION` live in `@lol/shared` only.
- **Prefill is client-side.** Nothing about a standing schedule is persisted by a read; the grid
  opens from it only while the week has no `answer` row, which is why "answered nothing" stays
  nothing (§4b).
- **A template is per team and per user**, enforced by a composite FK onto `membership`, so leaving
  the team takes the standing schedule with it.
- **Unlocking is past-only** (§5, §8). A week at or after `windowStart` answers 409 — otherwise an
  unlock would route around the skip cap that keeps a team from jumping to 2027. Re-locking is the
  same route with `unlocked: false`; there is no expiry yet (§12.4).
- **The skip cap is 8 weeks** (`MAX_SKIP_WEEKS`), and a refused skip is reported, not clamped
  silently: `applied: false` from the pure function becomes a 409 a captain can act on.
- **The window is computed, never stored.** `max(this week, floor)` is the only state: a stale floor
  heals itself, and there is no counter that leaves a team permanently ahead.
- **History is a derived read, not a mode.** Any Monday answers `GET /planner/:startsOn` for a
  member; the UI lists four weeks back. Reading needs no unlock, writing does.
- **The grid is the only input** (30-minute cells, the first cell decides paint/erase, one-step
  undo), and a week save replaces the whole week in one transaction with the `answer` upsert last.

## 12. Open questions

1. **Can a captain edit someone else's availability?** No. Built as a 403: naming somebody else in
   a week write is refused, and the route writes the caller otherwise.
2. **Is everyone's raw availability visible, or only the summary?** Both: the week payload carries
   every member's rows next to the computed windows, and the page shows the merged summary.
3. **Can members edit their own rows in an unlocked week?** Yes, and only their own — the unlock
   opens the week, never somebody else's rows (the 403 above still applies).
4. **Does an unlock expire?** Still open. Today it is until the captain re-locks it.
5. **How many weeks are retained?** All of them, forever. The UI lists four weeks back; the API
   already answers any Monday, so paging is a UI change, not a migration.
6. **Granularity**: 30 minutes. Decided 2026-11-21 — it is the grid's cell and scrims start on the
   half hour. Storing minutes keeps a later 15-minute grid a UI change, not a migration.
7. **Overnight sessions**: forbidden in v1. Decided 2026-11-21. A grid makes `23:00–02:00` look
   natural, so it needs a visible refusal ("add Monday's tail on Tuesday") rather than a silently
   clamped interval.
8. **Timezone**: one per team (`team.timezone`, default `Europe/Berlin`). Showing a member's own
   local time as well is still a nicety nobody has asked for.
9. **Does a member's availability require a complete profile?** No. The planner reads the roster,
   so nothing in it depends on a Riot ID.
10. **How far ahead may the captain skip?** Eight weeks, with "Back to this week" always one click
    away; beyond that the route refuses (409) instead of clamping silently.
11. **Per-week "no practice" flag** — still open. Skipping says "don't plan here", the flag says
    "we looked, there's nothing"; `week` exists now, so the flag is a column and a button.
