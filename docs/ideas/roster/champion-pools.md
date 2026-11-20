# Idea — champion pools (what a player *wants* to play)

**Status:** idea, nothing implemented.
**Depends on:** `player-profiles.md` (whose pool it is — a person, not a roster row) and
`hexserve-champion-data.md` (the champion name and icon shown in every cell — our own per-patch dump,
not a table of ours; see §4 below for the one-line contract).
`multi-team.md` only for tenancy of the one team-level list.
**Independent of:** `match-history.md` — pools work with no Riot integration at all; the only contact
is the `WR-BASIS` consumer in §9.
**Supersedes:** the sheet's hint *"Pool kommt automatisch"* — see §2.

## 1. The idea

Every player curates their own champion pool and everyone on the team can see all of them:

- a **Main pool** — the champions they actually want to play, in *their* order;
- a **Situational pool** ("Situativ / Extra") — the picks that fit specific games, again in their
  order;
- **Blue-side blind-pick options** (B1/B2 in the sheet) and **red-side blind-pick options** (R1/R2) —
  per player, because "what can you blind" is a personal answer;
- a **team-wide blind-pickable list**, grouped per role, because "we can always blind Corki" is a team
  decision and does not belong to whoever happens to play mid.

Everyone sees every row. **Only you edit your own.** The point is the conversation before and during
a game: open the page, see who can blind what, agree on the first three picks, and know it is
everyone's current opinion rather than someone's memory.

### What the screenshot pins down

| Observed | Consequence |
| --- | --- |
| rows = roles (`Top`, `Jungle`, `Mid`, `Bot`, `Sup`) plus a `Sub · Flo` row | rendering follows the **roster** (roles in `ROLES` order, substitutes included); the row is a *person*, not a role |
| two big blocks: `Main-Pool` and `Situativ / Extra` | two separate ordered lists per player, not one list with a flag |
| a champion name label above each icon cell, empty cells with just a dropdown arrow | the cell is the champion; empty slots are visible, so a half-filled pool reads as half-filled |
| bottom blocks: `B1 Options + B2 picks` · vertical `Blind Picks` · `R1 / R2 Options` | three more lists: blue-side per player, red-side per player, and one **team-wide** list in the middle |
| the centre block is a 5×4 grid (one row per role) | the team-wide list is **role-grouped** — its role is presentation, not ownership |
| the same champion appears in a pool *and* in the blind-pick block (Sion, Viego, TwistedFate, Corki, Karma) | blind-pick lists are **not** subsets of the pool (§6) |
| header labels are merged oddly (`Extra` at the top-right of the main block, `Situativ` per row) | spreadsheet artifact — take the *intent* (a long main list + a short situational list), not the exact grid geometry |

The fixed 13-column grid is also a spreadsheet artifact. Our version is a **variable-length ordered
list that wraps**, with a cap (§10.1) — nobody should have to scroll past nine empty slots.

## 2. Why this is *not* derived from match history

The sheet says "Pool kommt automatisch", i.e. derive the pool from what was played. Don't:

- history says what someone **played**; a pool says what they **want to play**. Those differ exactly
  when it matters — after a loss streak, when learning a new champion, when a pick only works in a
  specific matchup;
- a derived pool can never express **intent**: "I want to add Yone, I have not played it yet" is the
  most useful line in the whole feature;
- and it would be a lagging copy of data we already compute on the fly — `match-history.md` §8 shows
  per-champion games and winrate on demand, so "automatically" buys nothing but a second source of
  truth.

Consequence: pool membership is a **human decision**, stored like `match_annotation` in the other doc
— never computed, never overwritten by a sync, and the champion-stats view *consumes* it
(`WR-BASIS: nur Pool-Champs`) instead of producing it. That interface is spelled out in §9.

## 3. Whose pool is it — the one decision that shapes the schema

A pool belongs to a **person**, not to a roster row and not to a team:

- a roster entry can be created by the captain for someone who has never logged in, and it disappears
  when they leave — a pool must not;
- with `multi-team.md`, one person can be in two teams and still have one pool. That is correct and
  cheap: their competence does not fork per team;
- multiple Riot accounts do not fork it either — the pool is about the *player*.

So the owner is the **identity** (`profile.id` once `player-profiles.md` exists; `user.id` as the
interim key). Render it per team roster; store it per person.

The **team-wide blindpick list is the exception** — it is a team decision, team-scoped, and owned by
whoever the team says (§10.4).

## 4. Data model

```text
pool_entry       id (PK), ownerId → profile/user,           ← the person, see §3
                 kind ('main' | 'situational' | 'blue_blind' | 'red_blind'),
                 championId, position (0..n-1, dense, no gaps),
                 createdAt, updatedAt
                 UNIQUE (ownerId, kind, championId)         ← once per list (§6)
                 UNIQUE (ownerId, kind, position) DEFERRABLE INITIALLY DEFERRED   ← §5
                 INDEX (ownerId)

team_blindpick   id (PK), teamId → team, role (ROLES, nullable),
                 championId, position, updatedBy, updatedAt
                 UNIQUE (teamId, role, championId)
                 UNIQUE (teamId, role, position) DEFERRABLE INITIALLY DEFERRED
```

- **One table, four kinds**, because all four lists *are the same thing*: an ordered set of champion
  ids owned by exactly one person. Same guard, same drag component, same endpoint shape. Only the
  rendering and the caps differ.
- **`championId` only.** Name and icon are a lookup in the patch-keyed Hexserve cache
  (`hexserve-champion-data.md`), so "the pool is a name + an icon" is true on screen and one integer in
  the database. Renames and icon changes follow automatically, and a champion the dump does not know
  yet renders as its id rather than being rejected (§10.8).
- **No note column in v1.** The user asked for name + icon; a per-entry "why did I add this" is a
  real idea (§10.5) but it would be the first thing to go stale and the first thing to argue about.
- **No history/version table.** A reorder is destructive, and that is acceptable for a list whose
  whole content is "current opinion" — guarded by optimistic concurrency (§5), not by an audit trail.

## 5. Ordering — the only genuinely tricky part

The order **is the information**. "Sion, Ornn, Tahm Kench" says Sion is my first answer; the same
three alphabetically says nothing. So:

- **the order is shared, not personal.** Everyone sees the same arrangement — it is strategy, not a
  preference of the viewer. No per-viewer sorting, and no "sort alphabetically" that persists.
- **dense `position` 0..n-1**, rewritten on every change; no fractional indices, no gaps. With ≤ 15
  rows per list, the whole-list rewrite is smaller than the bookkeeping that gaps would need.

### Write the whole list, not the item

`PUT /api/pool` with the full ordered array (one call per kind, or all four kinds at once):

```text
PUT /api/pool   { version, lists: { main: [championId…], situational: […],
                                    blueBlind: […], redBlind: […] } }
→ 200 { version }        |  409 { reason: 'stale' | 'conflict' }
```

- **Reorder, add, remove and cross-kind moves become one operation.** Drag-and-drop already produces
  "the list after the move"; sending per-item PATCHes invents a sequence of intermediate states that
  nobody wants and that can half-fail.
- It is **atomic in one transaction**: dedupe → validate → delete-then-insert (or upsert with a
  deferred unique constraint) → bump `version`.
- **`version`/`updatedAt` is not optional.** Two tabs, or a phone left open from yesterday, will
  otherwise silently overwrite a rearrangement. A failed write the user cannot see is the worst
  failure mode for this feature: nothing errors, the pool just reverts.

### The unique-constraint trap

`UNIQUE (ownerId, kind, position)` plus naive row-by-row `UPDATE … SET position = …` hits a transient
violation in the middle of a reorder (`[A,B,C] → [B,A,C]` momentarily wants two rows at position 0).
Fix it with `DEFERRABLE INITIALLY DEFERRED` (checked at commit), or by rewriting the list
(delete + insert) inside the transaction. Discovering this in production means "reordering sometimes
fails with a 500" — pin it with a test that reorders a three-item list in both directions.

## 6. The four lists, and why blind picks are not a flag

A blind-pick list is **not** a subset of the main pool, and that is the whole point of it:

- you can blind a champion you do not main ("Corki is always blindable for us, even though nobody
  plays him much");
- the same champion legitimately appears in a pool *and* in a blind-pick list — the sheet does exactly
  this (Sion, Viego, TwistedFate, Corki, Karma are all in both);
- blind-pickability is **patch-dependent** and changes faster than a pool does. Modelling it as a flag
  on a pool entry would force "add it to my pool to flag it", which pollutes the pool.

So: `UNIQUE (ownerId, kind, championId)` — once *per list*, freely across lists. And a champion may
sit in one pool only, because a champion in "main" *and* "situational" makes the pool basis ambiguous:

- **`main` and `situational` are mutually exclusive** for the same player (a move between them is a
  `kind` change, not a second row);
- **`blue_blind` / `red_blind` may duplicate anything**, including each other and the pools;
- **`B1` vs `B2` is position, not a slot.** The sheet's labels describe a draft situation; what we
  store is "first option, second option, …". If the *meaning* of a slot ever needs to be explicit,
  that is a new column, not a new list (§10.6).

## 7. UI

- **One page, read-only by default, editable in your own row.** Everyone's row is always fully
  visible; only your cells get drag handles and an "add champion" cell. The affordance tells the truth
  even before the 403 does.
- **Rows**: roster order (roles from `ROLES`, subs last) — the sheet's layout, because a scrim
  conversation happens with everyone looking at the same picture.
- **Cells**: icon + name from the champion cache (`hexserve-champion-data.md` §6 — one call, current
  patch only), blue marker for blue-side blind-pick, red for red-side. A **legend is mandatory** — a
  coloured border with no key is a puzzle, not information.
- **This page is the best smoke test for that cache**: it is nothing but names and icons, so a
  regression in the dump integration is visible at a glance instead of buried in a stats table
  (`hexserve-champion-data.md` §11 step 4).
- **Reordering**: drag-and-drop for the pointer, **up/down buttons for the keyboard**. Both produce the
  same ordered array and call the same `PUT`; drag-only would make the feature unusable for anyone
  without a mouse, and the accent-key path is cheap.
- **Cross-kind drag** (main → situational) is supported, because it is the same gesture the user
  already makes; the payload just changes the `kind`.
- **"Stand: aktualisiert vor 3 Tagen"** per player row. A pool is an opinion; when it was last touched
  is part of reading it correctly, exactly like the refresh timestamp in `match-history.md` §9.
- **Empty is a state, not an error**: a player with no pool shows "noch kein Pool" and a completion
  line for the captain ("3 von 5 haben ihren Pool gefüllt") — the same chase-list thinking as
  `availability-planner.md`, one line here, no separate page.
- **Fast and cheap to re-read**: this page gets opened during champ select on a second screen. No
  spinner chain, no modal — it is a static table over ~60 rows of data.

## 8. Permissions

| Action | Guard |
| --- | --- |
| read every pool + the team blindpick list | `member` |
| write your own four lists | `member` + `ownerId === me` |
| write someone else's | **nobody** — not the captain either |
| write the team blindpick list | `captain` (§10.4 — or member; decide) |

The ownership check is a rule, so it is a plain function, not an `if` in a handler:
`canEditPool(me, ownerId)` in `packages/shared`, unit-tested — same shape as `canEditAvailability` and
`claimInvite`.

**Note the deliberate asymmetry** with `player-profiles.md`: the captain owns the roster (note, active,
team role), the player owns their profile *and* their pool. A captain who "fixes" a teammate's pool has
changed a statement of intent, which is not a typo to be corrected.

## 9. Interfaces to the other ideas

- **`match-history.md` §8 (champion stats)** consumes pool membership: `WR-BASIS: nur Pool-Champs`
  becomes `partitionByPool(statsRows, poolChampionIds)`, with the basis selectable (main /
  main+situational). The pools doc provides the ids; the stats doc computes the numbers. Neither
  imports the other's tables.
- **`match-history.md` §13** already assumes exactly this: "pool membership is a human decision,
  stored like `match_annotation`". This doc is that promise kept — and it stores **no** `isInPool` on
  a match or a participant row.
- **`hexserve-champion-data.md`** supplies the name/icon per `championId` and, optionally,
  `positions[]`/`roles[]` as a *hint* ("this is normally MIDDLE"). Use it to flag an odd pick, never to
  reject one — the pool is intent, not compliance (§10.7). That doc owns the cache and the
  version check; this doc only ever asks for a label.

## 10. Open questions (yours)

1. **Caps?** A hard cap keeps the page honest (a pool of 40 is a list, not a pool) and the sheet's grid
   implies ~10 main / ~4 situational. My read: soft-guidance in the UI, one hard sanity bound (~15 per
   list) so a paste cannot blow up the layout. Decide the numbers, not whether.
2. **Does the general/team blindpick list need sides?** The sheet splits the *per-player* lists by side
   and keeps the middle block side-neutral. If "blindable on red side 1 only" matters, `team_blindpick`
   needs a `side` column — cheap now, a migration later.
3. **Can a champion be in main *and* situational?** §6 says no (one pool per champion). If the team
   wants "situational" to *also* mark a main-pool champion as situational, that becomes a flag, not a
   list — a different model. Confirm the intent.
4. **Who edits the team blindpick list?** Captain (roster-like: the team decides) or any member
   (pool-like: opinions)? Recommendation: captain writes, everyone reads — otherwise the middle block
   becomes a merge conflict.
5. **Per-entry note** ("gut gegen Tanks", "nur mit Engage-Support")? It is the most valuable thing a
   pool can carry for a scrim conversation, and the user explicitly asked for name + icon only. v1: no.
   Revisit after the first month of real use, not before.
6. **Do `B1`/`B2`/`R1`/`R2` carry meaning?** Today they are "option 1, option 2". If the team wants
   "this works as B1 but not B2", that is a slot enum on the entry — say so before the UI hardens
   around ordering.
7. **Do we reject a pick outside the champion's usual role?** No (intent, and off-role picks win
   games) — but do we *show* a hint? Recommendation: a subtle marker, never a blocker.
8. **What happens to a pool entry for a champion that patches away** (removed/reworked id, or a patch
   the dump has not ingested yet)? Never auto-delete and never reject the write: render it as unknown
   and let the owner clean it up. Deleting someone's intent on a patch bump is the kind of silent data
   loss that is invisible until it is embarrassing — the same rule
   `hexserve-champion-data.md` §7 states from the dump's side.
9. **Mobile?** The page is read mostly on a second screen, but drag-and-drop on touch is a different
   implementation. Read-only on small screens with a "bearbeiten" mode is the honest cheap version.
10. **Does a substitute have a pool row?** Yes — `Sub · Flo` is in the sheet for a reason. Confirm they
    are ordinary roster rows in the render (§1).

## 11. Testing

| Layer | What |
| --- | --- |
| unit (`packages/shared`) | `canEditPool` (own / other / captain-of-other); `moveEntry(list, from, to)` incl. same-index and out-of-range; `validatePoolWrite` (duplicate within a kind → rejected, duplicate across kinds → allowed, main↔situational conflict → rejected, cap exceeded, unknown championId); `partitionByPool` for the stats basis |
| unit (`apps/api`) | the read model: pools + team list assembled per roster row in `ROLES` order, subs last; a player with no rows is present as empty rather than missing |
| integration | own write 200, someone else's 403, anonymous 401; a reorder in both directions does **not** hit the deferred unique constraint (§5); a stale `version` → 409 and **nothing is written**; a `PUT` with an empty list clears that kind and only that kind; a cross-kind move leaves one row |
| web | drag reorder persists and survives a reload; keyboard up/down does the same thing; other rows render without drag handles; blind-pick markers + legend; empty state and the completion line; unknown champion renders as a placeholder, not a crash |

The end-to-end test worth writing first: **two players, one pool each, one of them reorders and the
other's view changes** — it fails for any implementation that accidentally keys the order per viewer.

## 12. Suggested sequencing

This is the cheapest valuable feature in the repo: no rate limits, no background job, no external
source beyond a JSON file we already plan to cache. It can land **before** any Riot integration.

0. Decide §10.1 (caps), §10.3 (one pool per champion), §10.4 (who writes the team list).
1. **Schema + `canEditPool` + the read model**, with the ordering tests (deferred constraint, stale
   version). No UI yet.
2. **Champion names and icons**: `hexserve-champion-data.md` (its own slice — client, `champion`
   cache for the current patch plus the previous one, the retention rule, the `GET /api/champions`
   endpoint). Ids-only
   rendering is acceptable for a first look at the page, not for the team, so this is the one
   dependency worth doing first.
3. **The read-only page**: rows, icons, markers, legend, updatedAt, empty states.
4. **Own-row editing**: drag + keyboard, whole-list `PUT`, optimistic concurrency, cross-kind moves.
5. **Team blindpick block** (captain-owned).
6. Then the `match-history.md` `WR-BASIS` consumer, once champion stats exist.
