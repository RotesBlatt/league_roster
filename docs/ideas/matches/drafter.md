# Idea — the drafter (shadow a draft, get classified pick hints)

**Status:** idea, nothing implemented. The first consumer of [`opgg-meta`](../integrations/opgg-meta.md)
that is worth building the module for (§4 there asks exactly this question).
**Depends on:** `matchdays.md` (a draft belongs to a `match_game` of a series — this doc adds the
picks and bans), `opgg-meta.md` (the counter and synergy tables — the only source of "what beats
what"), `champion-pools.md` (whose pool the suggestions are drawn from), `player-profiles.md` (who
plays which role), `hexserve-champion-data.md` (champion ids and icons).
**Realtime:** ships on Tier 0 (poll), **built for Tier 1** — a live draft page is the best case for
push the app has, so the seam is designed now and SSE replaces the poll without a rewrite when
`realtime.md` has it (§11). Never a blocker: one shadower on one screen is already the whole feature.
**Not:** a win-probability oracle, an auto-picker, or an LLM writing sentences. It is a **lookup with
a sort order** (§4, §6).

## 1. The idea

A Liga match is best-of-N. During each game's draft, someone on the team — the captain, usually —
types the picks and bans into the app while the real draft runs in the League client. The app then
answers one question, for the pick that is *ours* to make next:

> **Which available champion from my pool is best here?**

and shows it as a short ranked list of champion icons, each carrying a few visual signals (matchup
edge, fit with what we already picked, pool membership, how much data backs the claim). Not a
paragraph. Not a sentence that says "you could play Orianna, she has 43% win rate" — a row in a sorted
list whose bar is long, whose arrow points up, and whose number is in a tooltip (§5).

The name for it, so the docs can be short: **the drafter**. "Shadow" is the entry mode; the output is
the *hint list*.

Two things this is not, and they are the two ways it can go wrong:

- **It is not advice about the draft as a whole.** op.gg gives pairwise counters and pairwise
  synergies. It has no idea what "we have no engage" means. A hint list built on pairwise numbers
  must never be dressed up as a composition judgement (§4.4).
- **It does not pick for you.** The list is ordered; the human looks at the scoreboard, the enemy's
  bans and their own gut. Every indicator on screen is there so the human can *disagree with the
  sort* — that is why they are indicators and not a single number.

## 2. Shadow, not client integration — Level 0

The real draft happens in the League client. Three ways to know what was picked, in ascending cost:

| | how | cost | failure mode |
| --- | --- | --- | --- |
| **Level 0 — shadow** | one member types pick/ban into the app; 20 actions per game (10 bans + 10 picks) | a form and a keyboard | mistyped champion, undone by hand |
| Level 1 — paste | after the game, paste the draft from the client or op.gg | less pressure, no live hints | no hints at all |
| Level 2 — LCU | talk to the local League client API (`https://127.0.0.1:…`, the `/lol-champ-select` endpoint) | a local bridge process on the shadower's machine, cert pinning, a browser it does not have | breaks on every client patch; only works on the machine that has the client |

**Level 0 is the feature.** Level 2 is a *second process on someone's PC* to replace 20 clicks spread
over ~2 minutes — and it cannot work from a browser anyway (the LCU speaks TLS with a self-signed cert
that a web page cannot accept). Write that down here so nobody spends a weekend on it before the
Level 0 flow has been used in one real match.

Level 1 matters for a different reason: **the draft is the record**. `matchdays` wants per-game picks
because "what did we pick into them last time" is a question people actually ask. A shadow that is
only a hint engine and stores nothing is a feature that makes the archive worse.

## 3. Fearless is a series rule, and it has variants

Fearless draft means champions are **locked for the rest of the series**. But which champions, and
whether bans also carry, is a *league* rule — and our series are `type ∈ {scrim, ace_league,
prime_league, other}` with `bestOf ∈ {1,2,3,4,5,7}` already modelled in `matchdays` §3.

```text
fearlessMode ∈ { none, picks, picks_and_bans, global_bans }
```

- `none` — standard draft: scrims and flex. Every game starts clean. The default for a new series,
  because a scrim block is the common case.
- `picks` — a champion **picked** in game *n* may not be picked again in games *n+1…*. Bans reset each
  game. This is the common competitive form, and the one to implement first.
- `picks_and_bans` — bans also carry. Cheap to support once `picks` works: the same union, a wider set.
- `global_bans` — a separate pre-series ban phase where both teams ban champions for the whole series,
  on top of per-game bans. Also a union; also the same code.

**The state is derived, never stored.** It is `union(picks (and bans) of games 1..n-1 of this
series)`, computed by a pure function from the games that already exist. A stored `fearless_locked`
column would be a second source of truth that goes stale the moment someone fixes a mistyped game 2 —
exactly the failure `matchdays` §4 refuses for `score`.

**Bo1/Bo3/Bo5 is not a new concept here.** The series length already exists as `bestOf`, the games as
`match_game.idx`, and "how many games are left" is `isSeriesComplete()` there. The drafter adds no
series notion of its own; it *reads* one.

## 4. What a hint is — four signals, one sort order

### 4.1 Inputs

```text
draft state      our picks, enemy picks, bans so far, whose turn it is, our role in this game
availability     not banned, not already picked, not fearless-locked (§3)
our pool         main / situational / blind-pick lists per player (champion-pools)
counter table    op.gg weak_counters per enemy champion, per lane (opgg-meta §3.2)
synergy table    op.gg synergies per lane pair (opgg-meta §3.3)
```

### 4.2 The composite, spelled out

For each candidate `c` for our open role `r`:

```text
matchup(c)  = the counter row for (c vs the enemy laner in r)         → edge, sample
comp(c)     = best synergy row between c and each of our already-picked champions
              (op.gg: one lane pair per call — §4.3)
pool(c)     ∈ {main, situational, blind_pick, unlisted}                → shown, not scored
legal(c)    = not banned, not picked, not fearless-locked
score(c)    = matchup_edge × w_matchup + comp_edge × w_comp          ← weights are constants
```

`score` exists **only to sort**. It is never rendered — no "82 points" badge, because a number that
precise invites trust the data has not earned (samples of 161 games, §4 of `opgg-meta`).

### 4.3 Two tables, two shapes of work

- **Matchup** is one lookup: the enemy laner's `weak_counters`, filtered to legal candidates. That is
  the "what am I laning against" half, and it is cheap — the whole draft's matchup hints are 5 lookups
  per game.
- **Comp fit** is one call per (candidate, our picked lane) pair, because `lol_get_champion_synergies`
  takes *one* ally position at a time. In practice: cache the synergy table per patch for the pool
  (a few dozen champions × 4 positions), not per draft. A live draft must not make 40 HTTP calls.

### 4.4 The honest limit

Pairwise counters and pairwise synergies do not compose into "is this a good comp". Two 55% pairings
can be the worst possible draft (double AD, no engage). So:

- **the hint list is about the pick, not the draft** — its header says "Mid" and the role icon, not
  "our draft score";
- **no composition numbers anywhere**, ever. If we later want "we lack magic damage", that is a rule
  of our own over `damage_type` (which op.gg does give), and it belongs in a separate signal with a
  separate test — not smuggled into `score`.

### 4.5 The indicator vocabulary (this is what "not as text" means)

One row per candidate, sorted by `score`. Every signal is a glyph; the numbers live in a popover,
because a number in the row makes people read instead of scan.

| signal | glyph | meaning |
| --- | --- | --- |
| matchup edge | arrow up / flat / down, coloured from the palette | candidate's win rate into the enemy laner, above / at / below even |
| sample strength | filled vs hollow dot at the arrow's tail | `play` above our floor (filled) or below it (hollow → demoted, never hidden) |
| comp fit | 0–3 link marks | best synergy tier with a champion we already picked (`0=OP … 4=C`, inverted) |
| pool | star (main), half-star (situational), ring (blind-pick), nothing (unlisted) | which of *their* lists it came from |
| illegal | greyed out, struck through, no score | banned / picked / fearless-locked (§3) — shown, so nobody wonders where it went |
| rank | the row's position | the sort *is* the recommendation |

Colours come from the `ui-rework` tokens and mean one thing each; the arrow must not be the only
difference between two rows (shape + colour + position, per the usual accessibility rule).

**The trap to write down once, in bold:** on a `weak_counters` row, `my_win_rate` is the *enemy's*
win rate and `counter_win_rate` is the *pick's*. Read one field wrong and every hint inverts —
"Orianna 43% into Vel'Koz" is `counter_win_rate`; `my_win_rate` on the same row is Vel'Koz's number.
That is a unit test, not a code review note (§10).

## 5. Partial information is the normal case

A draft is 20 actions in a fixed order, and most of them happen before our pick is due. The hint list
must handle three states of knowledge:

1. **Enemy laner unknown** (they have picked top/jungle but not mid). No matchup signal at all — show
   comp fit and pool only, and say so with an empty arrow slot, not a fake "even".
2. **Enemy laner known, our role not yet** (we blind-picked first). Matchup is against whoever is
   revealed in that lane so far; the row is the *lane*, and re-sorts the moment the enemy laner lands.
3. **Post-draft.** The hint list is still useful in the archive — "what did we have available and not
   take" is a genuinely instructive read after a loss, and it is free once §2 Level 0 stores the
   actions.

Turns matter for a second reason: **bans are hints too.** In our ban phase the same table answers
"what should we ban", which is the mirror query (the enemy's `strong_counters` are the champions they
would punish us with). Same data, different filter — in scope, but as a separate list (§13.5).

## 6. Pool first, the whole roster only when the edge is real

The user-facing rule, stated so it can be tested rather than argued about:

- **Default: pool only.** `champion-pools` is a human statement of what someone *wants* to play, and
  a hint that ignores it is an argument, not advice.
- **Widening is allowed** when the matchup edge is large *and* backed by enough games: a named-floor
  function, e.g. `counter_win_rate ≥ 0.55 && play ≥ 500` (1424 counters are why the floor exists),
  and only when no legal pool champion clears the same bar. Widened picks are marked as unlisted
  (no star) so the human sees immediately that the app went outside the pool.
- **Never widen for comp fit.** "You have never played it, but it pairs well with our jungle" is how a
  draft tool becomes a liability.
- The thresholds are named constants in one module with tests, not magic numbers in a component.

## 7. The picker: lane, search, filters — hexserve already paid for most of it

Level 0 (§2) is 20 entries under time pressure, so the entry surface *is* the feature. Nearly all of
it is already built: `GET /api/champions` returns one label per id with `championId`, `name`, `slug`,
`iconUrl`, `positions[]`, `roles[]`, patch-stamped, ~170 rows, already flattened and already rendered
by `ChampionIcon`/`ChampionLabel`. The drafter adds **no** champion endpoint and **no** champion
table — it reuses the cache and the placeholder rule.

### 7.1 The layout is the client's layout — decided

The shadow is typed by someone who is *also* looking at the real champ select, so our screen copies it
instead of inventing a better one: **our five pick slots down the left, the enemy's five down the
right, ban strips above and below, and all champions in a grid in the middle.** Left is always *us*,
labelled with the actual side from `match_game.side` (`BLUE` / `RED`) — that is what the client does
(the player is left whatever side they drew) and it is where the shadower's eye already is.

```text
  bans  ▪▪▪▪▪                                          ▪▪▪▪▪  bans
  ┌──────────┬──────────────────────────────────────────────────┬──────────┐
  │ us  BLUE │  [ search ]   All  Top  Jun  Mid  Bot  Sup        │ RED them │
  │ 1 Aatrox │  ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪  │ 1   —    │
  │ 2   —    │  ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪  │ 2 VelKoz │
  │ 3   —    │  ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪  │ 3   —    │
  │ 4   —    │  ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪  │ 4   —    │
  │ 5   —    │  ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪ ▪▪  │ 5   —    │
  └──────────┴──────────────────────────────────────────────────┴──────────┘
  bans  ▪▪▪▪▪                                          ▪▪▪▪▪  bans
```

The two things worth copying from the client beyond the skeleton: **the pick-order number on every
slot** (1·2·3·4·5 tells the shadower at a glance whether the next action is ours), and a **glowing
"current action"** slot wherever the real client is waiting — that glow is the cue that the hint list
is for *this* pick (§4) and not the previous one.

### 7.2 Lane tabs are a *view* over the full grid — never a filter

The middle grid always contains **all** champions: `All` is the default tab and nothing is ever
removed from it. `Top · Jun · Mid · Bot · Sup` are convenience tabs — "what would generally be
available in mid" — so you can eyeball a lane's worth of champions without scrolling 170 icons. That
is the request, and it is a *navigation* device, not a claim about this game.

Because it makes no claim, the dump's `positions[]` **is** allowed here: it means "normally plays
mid", which is precisely what the tab shows. What keeps that honest is three rules:

- **nothing is hidden.** A champion absent from every `positions[]` still appears under `All`, and
  in a lane tab it sorts into a "no lane listed" tail. A filter would hide it; a sort cannot.
- **the tab is not a legality check.** `Mid` shows the champions that normally play mid, not "the
  champions that may legally be picked mid", and it says so in its own label.
- **the tab is not the evidence.** The matchup arrow (§4.5) still comes from op.gg's empirical
  per-position table (§4.3), never from the dump. Navigation and evidence are different things and
  must not be wired to the same field.

`hexserve-champion-data.md` §9.5 *asks* whether `positions[]` is trustworthy enough to display as a
hint, and `apps/api/src/hexserve/client.ts` answers *"Hints only: never a filter, never a warning
colour."* A lane tab as an ordering respects both; grouping *the hints themselves* by it would not.

Where op.gg's `role_rate` is available it is the better within-tab sort — high = genuinely a mid, low
= a fill pick — because it is empirical and it is already paid for: the lane table comes with the
per-patch cache (§4.3).

### 7.3 Search: match what is on screen, and the slug too

One text field, filtering as you type, over **`name` and `slug`**, normalised: lowercase, diacritics
stripped, apostrophes and punctuation removed. Why both and why normalise, concretely:

- `Kai'Sa`, `Cho'Gath`, `Vel'Koz`, `Nunu & Willump`, `Dr. Mundo` — punctuation is in the names;
- the slug rescues the spelling someone actually types (`leblanc` → `LeBlanc`, `reksai` → `Rek'Sai`);
- labels are **locale-bound** (`championLabelFor` is per-locale), while slugs are not — searching the
  slug keeps the picker working when the label is German and the player types the English name;
- `positions[]`/`roles[]` are *not* searchable text. Searching "mid" must not return every mid.

`searchChampions(labels, query)` is a pure function and gets a unit test (§10) — the diacritics and
apostrophes are exactly the kind of thing that looks fine until someone types `kogmaw`.

### 7.4 Filters and sort order are controls, not assumptions

Everything is client-side: one payload, ~170 rows, no request per keystroke.

- **Filters** compose and are *all* optional: availability (default: legal shown, illegal greyed —
  §4.5), pool source, op.gg tier, sample floor. Named toggles, not a query string nobody can see.
  The lane tabs above are **not** in this list — they sort, filters remove (§7.2).
- **Sort** is an explicit choice with the score as *default*: `score` (the hint), `pool order` (the
  player's own ordering — the one that lets someone disagree with the algorithm without leaving the
  screen), `name`, `tier`, `play`.
- **Default grid** is "all champions, sorted by score, illegal greyed". Widening (§6) is a visible
  toggle, so "why is a champion I never play at the top" always has an answer on screen.

### 7.5 Entry mechanics (this is the real cost of Level 0)

Click a champion in the grid → it lands in the **current action slot** highlighted in §7.1, on the side
that is actually acting (a ban strip during the ban phase, a pick slot during picks); type → filter,
`Enter` → take the top match; undo-last on one button. Twenty actions spread over ~2 minutes, so the
entry must never require a modal, a confirm, or a page change. Mistypes are undone by hand, which is
the honest failure mode claimed in §2.

### 7.6 What hexserve cannot do, and why that is fine

A champion released between dump refreshes has no label yet → `championLabelFor` returns `null` and
`ChampionIcon` renders `#id` (its existing rule: nothing throws). So a brand-new champion is simply
absent from the widened list until the dump catches up, and the *illegal* columns still show ids when
a pick references a champion we do not know. Never fix this by fetching a name at render time; that
is the per-patch resolution `hexserve-champion-data.md` §4 exists to prevent.

The header's existing `PatchStatus` chip answers "which patch are these hints from" for free — and
that question is not cosmetic here, because the counter and synergy tables are patch-scoped (§4.3,
`opgg-meta` §5).

## 8. Model sketch

Small, because it hangs off `matchdays` §3 rather than inventing a series model:

```text
match.fearlessMode ∈ {none, picks, picks_and_bans, global_bans} default 'none'   ← §3

draft_action   id, gameId → match_game, seq int,          ← 1..n, the order it happened
               kind ∈ {ban, pick},
               side ∈ {blue, red},
               championId int,                            ← our ids (hexserve), not names
               role ∈ ROLES | NULL,                       ← NULL for bans
               UNIQUE (gameId, seq)

match_game.draftSource ∈ {manual, import} | NULL
```

- **Actions, not arrays.** A JSONB `{blueBans: [...], redPicks: [...]}` is smaller and cannot express
  *when*; a live drafter needs "undo the last one", which is a row, and a ban-phase hint list needs
  "what was banned before this pick". Twenty rows per game is nothing.
- **`seq` is the draft order**, so replaying a draft is `ORDER BY seq`, and the fearless set is
  `WHERE kind IN (picks…) AND gameId IN (previous games of this series)`.
- **Champion ids, not names.** op.gg speaks names (`"Orianna"`, `"Vel'Koz"`), we key by id
  (`opgg-meta` §5 rule 4). One mapper, one test.
- Bans are stored even for `fearlessMode = none`, because "what did they ban against us" is the most
  useful line in the archive and costs nothing to keep.
- **One read route is the whole live surface**: `GET` on the game returns `{ actions[], hints[] }` —
  the actions in draft order and the hint list already computed server-side (§4). That single payload
  is what §11's query key holds, and it is why a live update is one refetch rather than a
  client-side recomputation.

## 9. Where each signal comes from, and what happens when it is missing

| signal | source | if unavailable |
| --- | --- | --- |
| availability | our own `draft_action` rows | — (always ours) |
| pool | `champion-pools` | empty pool → hint list is the widened list, marked unlisted |
| matchup | `opgg-meta` counter table, cached per patch | **no arrows at all**, list sorted by pool order. Never a guessed arrow |
| comp fit | `opgg-meta` synergy table, cached per patch | no link marks |
| role | `player-profiles` / roster | ask in the draft header (a dropdown), once per game |

**Degradation is a design rule, not an error path.** A draft takes minutes and cannot wait for an
upstream: every op.gg-derived signal is optional, and the screen is still a legal, useful pool list
without it. This is the whole reason `opgg-meta` insists on a per-patch cache with a "last known
patch" render (`opgg-meta` §5 rule 2).

## 10. The pure functions (and what gets unit tested)

The drafter's thinking lives in plain modules so the component is dumb — `AGENTS.md`'s rule, and the
only way this is testable at all:

```text
fearlessSet(games, mode)              → Set<championId>        // §3, no storage
legalCandidates(draft, series, mode)  → championId[]
matchupSignal(candidate, enemyLaner, table, rules) → {edge, sample, trusted}
synergySignal(candidate, ourPicks, table)          → {links, tier}
hintList(ctx)                         → Hint[]  // the sorted, classified rows — the one entry point
widen(legal, pool, table, rules)      → {candidates, widened: boolean}

// the picker (§7) — presentation logic, still pure, still no component
normalizeForSearch(text)              → string   // lowercase, no diacritics, no punctuation
searchChampions(labels, query)        → ChampionLabelDto[]
laneOf(championId, laneSource)        → Role | null   // pool | opgg table | null — never hexserve.positions
sortCandidates(hints, order)          → Hint[]   // score | pool order | name | tier | play
```

Tests worth writing before the code (fixtures, no network, no DB):

- `fearlessSet` — each mode; a Bo3 with picks in games 1–2; a ban that was never picked must *not*
  lock under `picks`; `global_bans` unions the pre-series phase.
- the **inversion test**: given one `weak_counters` row, `hintList` shows `counter_win_rate` and not
  `my_win_rate` (§4.5). This is the bug that would silently invert every recommendation.
- `matchupSignal` with a hollow sample: demoted, still present.
- `widen`: no pool pick clears the floor → one unlisted pick appears, marked; a pool pick clears it →
  no widening. Both directions.
- `hintList` with partial information: enemy laner unknown → no arrow, no crash (§5.1).
- Bo5 series where game 4 was never recorded: derived state must not invent locks.
- `searchChampions` — `kogmaw` → Kog'Maw, `kaisa` → Kai'Sa, `leblanc` → LeBlanc via either field,
  `dr mundo` → Dr. Mundo, and an empty query returns everything rather than nothing. A German label
  and an English `slug` must both match (§7.3).
- `laneTab` — **no test may assert that a champion is hidden.** A champion listed for mid *and*
  support appears in both tabs; a champion with `positions[] = []` still appears under `All` and
  lands in the "no lane listed" tail of every tab (§7.2). The regression this guards is a lane tab
  quietly becoming a filter and losing a champion from the grid.
- `sortCandidates` — equal scores keep a stable order (pool order as the tiebreak), so the list does
  not jump between renders.

## 11. Two users, one shadower — and why this page wants live updates

Only the shadower writes; watchers read. That is a *product* fact, and it makes the draft the best
case for push the app has: the data changes because **someone else is typing**, on a 30-second clock,
while a coach or two teammates are looking at their own screens. A 10-second poll lag is acceptable;
a pick appearing the moment it is entered is a real win.

So: **ship on Tier 0, build for Tier 1.** The seam is four rules, and together they mean switching the
poll for SSE is a line, not a redesign:

1. **One query key, one read.** The draft state is `['draft', gameId]` fetched from the server and
   rendered from that alone. No second client-side source of truth about the draft — that is the
   thing that makes "live" hard.
2. **Events are refetch hints, never state** (`realtime.md`'s rule, and this page is where it earns
   its keep). An SSE event invalidates the key; the watcher re-reads. The SSE render and the poll
   render are therefore *identical by construction* — only the latency differs, so nothing has to be
   re-verified when Tier 1 lands.
3. **The poll must be sufficient on its own.** If the interval would leave a watcher guessing during
   the draft window, the interval is wrong — realtime is an upgrade, never a dependency.
4. **The write path must not need realtime.** The shadower's screen is optimistic local state
   (§7.5), so a dead socket cannot lose an entry; the next read reconciles.

Two consequences worth stating, because they are the cost of getting this wrong:

- **Hint recomputation must not ride the push.** Hints come from the per-patch counter/synergy cache
  (§4.3), so a refetch is one cheap query, not 40 op.gg calls. If a live update ever costs an
  upstream call per event, the design has drifted.
- **A watcher must never see a hint list for a draft that has moved on.** That is exactly why the
  event is a refetch rather than a patch — the hint list is derived server-side from the same rows
  the event made stale.

If `realtime.md` Tier 1 has landed when this is implemented, wire it and say so in the patch; if it
has not, ship the poll and leave the four rules in place. What we must not do is build a **second**
realtime transport just for the draft page.

## 12. Before any of this: is it allowed?

A tool that suggests picks during an **official** draft may be against the competition's rules —
"external software that influences champion select" is the kind of clause leagues write. Nobody has
checked for ACE League / Prime League, and this is a question for the rulebook, not for us.

Consequence for the plan: **build it for scrims first.** A scrim block is `type = scrim`,
`fearlessMode = none`, no rules committee, and it is where the hint list gets calibrated anyway. If it
ever shows up on a Liga matchday, that is a decision made with the rulebook open, recorded here.

## 13. Open questions

1. **Who shadows, and on what?** The captain on a second monitor is the obvious answer; a phone is the
   realistic one during a Liga game, which makes the entry flow a *mobile* flow (20 taps, not 20
   keystrokes). That changes the design more than any scoring decision.
2. **Which fearless variant does each of our leagues actually use?** Default to `picks` and let the
   series override; confirm with one person per league before the first competitive block.
3. **How much latency is acceptable between the real draft and our screen?** If shadowing lags by more
   than ~10 seconds it is useless for hints and only useful for the archive — which is Level 1, and
   that is fine to ship first.
4. **Do we show enemy-side hints?** "What should they pick" is the same query with the sides swapped,
   and it is genuinely useful *before* a match when reviewing a VOD. Kept out of the live screen.
5. **Ban hints in the ban phase** (§5) — same table, mirror filter. Separate list, separate patch.
6. **Calibration.** Nothing here proves the composite weights are good. The real test is a scrim block
   where someone wrote down whether they agreed with the top 3 — 20 games of that, then look.
7. **Does the board need the enemy's *available* lanes, not just their picks?** A lane column can say
   "Vel'Koz" only once they have picked it; before that the column is empty and §5.1 applies. If
   people want "they will probably play X there", that is a prediction, and it is out of scope.
8. **Does the grid need the champion's *own* pool marker inside a lane tab?** §4.5 puts a star on pool
   picks; in a lane tab that is the one column where "mine" and "normally mid" disagree most often.
   Cosmetic until someone tries it.
9. **What does one realtime topic cover — the team or the game?** §11 needs "this draft changed". A
   `team` topic is one subscription and leaks nothing but a draft in progress; a per-game topic is
   tighter but needs `realtime.md`'s bus to support dynamic topics. Ask it when Tier 1 is built, not
   now — a wrong answer here is a rewrite of the subscribe call, not of the page.
10. **Does the poll land in Tier 0 before we need it?** `realtime.md` lists "the matchday poll" as
    remaining Tier 0 work; §11 rule 3 depends on that existing rather than being reinvented here.
    Small ordering question, but it is the difference between one poll and two.
