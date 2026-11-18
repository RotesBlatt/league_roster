# Idea — availability planner (the spreadsheet's week planner)

**Status:** idea, nothing implemented.
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
- **`answer` is a separate row from `availability`, and that is what makes "hasn't answered"
  expressible.** Someone who is free *nowhere* this week has zero availability rows either way;
  without an `answer` row, "I answered: nothing" and "I forgot" are indistinguishable. One extra
  row per member per week, and the captain gets a chase list.

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

### Does `week` still need to be a table?

If the window is derived, `week` is a denormalized date range. Keep it anyway:

1. a home for per-week metadata that will be asked for soon ("no practice this week", a note);
2. a stable FK anchor for `availability`;
3. `UNIQUE (teamId, startsOn)` makes lazy creation idempotent.

Provision lazily — on first read or write of a window week, `INSERT … ON CONFLICT DO NOTHING`. No
cron job, nothing to forget to run.

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
| read a past week (history) | `member` |
| write your own availability | `member` + `userId === me.id` |
| write someone else's | captain only — **decide** (see §11) |
| skip the window / back to this week | `captain` |
| unlock a finished week for editing | `captain` |

The ownership check is the interesting one: it's the first route in this codebase where being a
member is not enough. It belongs in a plain function (`canEditAvailability(me, targetUserId)`), not
inline in the handler — same rule as `claimInvite`.

## 9. UI

- **Input:** per-day list of intervals with an "add interval" row, not a drag-select grid. Cheaper,
  works on mobile, accessible, and the data model doesn't care. A drag grid is a later upgrade.
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

## 11. Open questions

1. **Can a captain edit someone else's availability?** Convenient for fixing typos, but it makes
   "editable only your own" untrue. My read: no, keep the rule clean.
2. **Is everyone's raw availability visible, or only the summary?** The summary is public by
   definition; raw entries are a transparency choice. I'd show them — it's a team tool.
3. **Can members edit their own rows in an unlocked week?** Likely yes — but the captain's unlock
   must not silently grant edit rights over *other people's* availability.
4. **Does an unlock expire?** Until the captain re-locks it, or auto-lock after N days? A week left
   open forever invites quiet edits to settled history.
5. **How many weeks are retained?** All of them, forever, or prune after N? "Never lost" is the
   stated requirement, so: keep all, and let the UI page through history later.
6. **Granularity**: 30 minutes, or 15?
7. **Overnight sessions**: forbid in v1, or support `end > 1440` from the start?
8. **Timezone**: one per team, or per member? (v1: per team.)
9. **Does a member's availability require a complete profile?** Probably not — availability is
   useful even before someone has set a Riot ID.
10. **How far ahead may the captain skip?** (§5) A cap (~8 weeks) plus "back to this week" is the
    guardrail; unbounded needs a real answer for getting back.
11. **Per-week "no practice" flag** — separate from skipping? Skipping says "don't plan here", the
    flag says "we looked, there's nothing". Both are useful; the flag is cheap once `week` exists.
