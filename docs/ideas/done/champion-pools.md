# Idea — champion pools (what a player *wants* to play)

**Status:** done 2026-11-25 — shipped end to end: `pool` + `pool_entry` (migration 0016), the shared
rules, `GET /api/teams/:slug/pools`, `PUT /api/pools`, and the pool page with drag, right-click
actions, the trash bin and autosave. Commits `241f8d3` … `61a64c1` (`feat(shared)`, `feat(api)`,
`feat(web)`). Model revised 2026-11-25: **three side-neutral lists per player** (`main`,
`situational`, `blind`), the blue/red blind split and the team-wide block dropped.
**Depends on:** `player-profiles.md` (whose pool it is — a person, not a roster row) and
`hexserve-champion-data.md` (the champion name and icon shown in every cell — our own per-patch dump,
not a table of ours; that slice is **done**).
**Independent of:** `match-history.md` — pools work with no Riot integration at all; the only contact
is the `WR-BASIS` consumer in §9.
**Supersedes:** the sheet's hint *"Pool kommt automatisch"* — see §2.

## 1. The idea

Every player curates their own champion pool and everyone on the team can see all of them:

- a **Main pool** — the champions they actually want to play, in *their* order;
- a **Situational pool** ("Situativ / Extra") — the picks that fit specific games, again in their
  order;
- a **Blind-pick list** — what they are willing to first-pick, side-neutral, in their order.

Everyone sees every row. **Only you edit your own.** The point is the conversation before and during
a game: open the page, see who can blind what, agree on the first three picks, and know it is
everyone's current opinion rather than someone's memory.

### What changed on 2026-11-25, and why

| Was (the sheet) | Now | Reason |
| --- | --- | --- |
| `B1/B2` blue-side and `R1/R2` red-side blind lists per player | **one** `blind` list | the side distinction was paperwork: what a player can blind is a property of the player and the patch, not of the side. Keeping two lists forced the same champion into two lists to say one thing. |
| a team-wide blind-pickable list per role, in the middle block | **dropped** | "we can always blind Corki" is already answerable by reading the five `blind` lists; a second, team-owned copy of the same opinion is the one that goes stale, and it needed its own owner and guard. If it turns out to be missed, it is a small table on top of this model — not a reason to carry it now. |
| two pool blocks + three blind blocks, five lists per person | **three** lists per person | the five-list grid was a spreadsheet layout, not a model. |
| scores of empty cells implied by a fixed 13-column grid | variable-length list that wraps, hard cap 15 per list (§10.1) | nobody should have to scroll past nine empty slots to find the add button. |

"Blind-pickable champions should be good" is now a **filter over the data we have**, not a field:
each player's `blind` list is the answer to "can we first-pick", and the pool page is where that
gets discussed. Nothing is scored or derived.

### What the screenshot still pins down

| Observed | Consequence |
| --- | --- |
| rows = roles (`Top`, `Jungle`, `Mid`, `Bot`, `Sup`) plus a `Sub · Flo` row | rendering follows the **roster** (roles in `ROLES` order, substitutes included); the unit is a *person*, not a role — here one column each, see §7 |
| two big blocks: `Main-Pool` and `Situativ / Extra` | two separate ordered lists per player, not one list with a flag |
| a champion name label above each icon cell, empty cells with just a dropdown arrow | the cell is the champion; an empty list is visible, so a half-filled pool reads as half-filled |
| the same champion appears in a pool *and* in the blind-pick block | blind is **not** a subset of the pool (§6) |

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

So the owner is the **identity** (`user.id`, which is what a pool can be keyed on **today**;
`profile.id` if profiles ever stop being 1:1 with users — no code depends on which, since the route
resolves "me"). Render it per team roster; store it per person.

The 2026-11-25 trim removed the one exception: there is **no team-scoped pool table any more**. Every
list in this feature has exactly one kind of owner (a person) and exactly one guard (owner-only), so
the permission model is one rule instead of two.

## 4. Data model

```text
pool        ownerId (PK) → user,               ← the person's header row (§5)
            version integer not null default 0,
            updatedAt

pool_entry  id (PK), ownerId → pool (cascade),
            kind ('main' | 'situational' | 'blind'),
            championId integer,
            position (0..n-1, dense, no gaps),
            createdAt, updatedAt
            UNIQUE (ownerId, kind, championId)        ← once per list (§6)
            UNIQUE (ownerId, kind, position) DEFERRABLE INITIALLY DEFERRED   ← §5
            INDEX (ownerId)
```

- **One table, three kinds**, because all three lists *are the same thing*: an ordered set of champion
  ids owned by exactly one person. Same guard, same drag component, same endpoint shape. Only the
  rendering and the cap differ.
- **A `pool` header row per owner** so `version` and `updatedAt` have a home: they are facts about
  the person's whole pool, not about a list or an entry, and "Stand: aktualisiert vor 3 Tagen" would
  otherwise be `max(entry.updatedAt)` — which lies after a clear (the pool is empty and looks never
  touched).
- **`championId` only.** Name and icon are a lookup in the patch-keyed Hexserve cache
  (`hexserve-champion-data.md`, **done**), so "the pool is a name + an icon" is true on screen and one
  integer in the database. Renames and icon changes follow automatically, and a champion the dump does
  not know yet renders as its id rather than being rejected (§10.8).
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

### Write the whole pool, not the item

`PUT /api/pools` with the full ordered arrays (all three kinds at once):

```text
PUT /api/pools  { version, lists: { main: [championId…], situational: […], blind: […] } }
→ 200 { version }        |  409 { reason: 'stale', version }   |  422 { details: […] }
```

The body names **no owner**: the person comes from the session, so "nobody may write somebody
else's pool" is structural rather than a check a handler could forget. That also removed the 409
`conflict` reason — the only way to lose a race here is a stale version.

- **Reorder, add, remove and cross-kind moves become one operation.** Drag-and-drop already produces
  "the list after the move"; sending per-item PATCHes invents a sequence of intermediate states that
  nobody wants and that can half-fail.
- It is **atomic in one transaction**: validate → bump `version` under an optimistic `WHERE` →
  delete-then-insert. A duplicate is *rejected*, never silently deduped: a client that sent it has a
  bug, and dropping one of the two would hide it.
- **`version`/`updatedAt` is not optional.** Two tabs, or a phone left open from yesterday, will
  otherwise silently overwrite a rearrangement. A failed write the user cannot see is the worst
  failure mode for this feature: nothing errors, the pool just reverts.

### Autosave — there is no Save button

Every gesture is a complete statement about the pool (add, remove, reorder, throw away), so the page
writes it **immediately**. The one thing that must not happen is two writes racing each other: a
reorder sent at version 7 is still in flight while the next gesture is made, and two parallel `PUT`s
would turn the second into a `409` against our own first write.

So the client keeps **one queued payload** (`usePoolEditor`): while a request is running, newer edits
*replace* the queue instead of stacking (nobody wants the intermediate states), and the next request
is sent with the version the previous one returned. A `409` therefore means what it always meant —
*somebody else* wrote first — and it drops the draft and refetches. The header says "saving…" while a
write is in flight and nothing else; a success needs no toast, because the pool on screen **is** the
confirmation. There is no draft-versus-saved distinction left to explain, and no way to leave the
page with unsaved work.

### The unique-constraint trap

`UNIQUE (ownerId, kind, position)` plus naive row-by-row `UPDATE … SET position = …` hits a transient
violation in the middle of a reorder (`[A,B,C] → [B,A,C]` momentarily wants two rows at position 0).
Fix it with `DEFERRABLE INITIALLY DEFERRED` (checked at commit), or by rewriting the list
(delete + insert) inside the transaction. Discovering this in production means "reordering sometimes
fails with a 500" — pin it with a test that reorders a three-item list in both directions.

## 6. The three lists

- **A champion may be in `main` or `situational`, not both** — a champion in both makes the pool
  basis ambiguous (§9). A move between them is a `kind` change, not a second row.
  `UNIQUE (ownerId, kind, championId)` cannot express this on its own, so the shared rule
  (`validatePoolWrite`) rejects it.
- **`blind` is independent and may duplicate anything**, including `main`, `situational` and itself
  across lists. That is the whole point: you can blind a champion you do not main ("Corki is always
  blindable for us, even though nobody plays him much"), and the sheet does exactly this.
- **Blind-pickability is patch-dependent** and changes faster than a pool does. A flag on a pool entry
  would force "add it to my pool to flag it", which pollutes the pool — which is why it is a third
  list and not a column.
- There is no `b1`/`b2`/`b1_only` slot meaning any more: position is priority, nothing more. If that
  ever needs meaning, it is a new column, not a new list (§10.6).

## 7. UI

- **One page, read-only by default, editable in your own column.** Everyone's column is always fully
  visible; only your chips get drag handles and an "add champion" chip. The affordance tells the truth
  even before the 403 does.
- **Columns, one per person**: role order (`ROLES`: TOP → SUP), then name, then the roleless last,
  because a scrim conversation happens with everyone looking at the same picture. A column is a
  *person*, and its header is `role · name` — so in the normal case the page reads as the five roles
  left to right (`TOP · Jan`, `JUNGLE · Ben`, …), and two people on the same role simply get two
  adjacent columns instead of fighting over one cell.
- **The five role slots are always drawn.** A role with nobody on it is an empty dashed column saying
  "no player yet" — not a missing column. A grid whose width changes as people join and leave makes
  the reader count to find out which role is gone, and a pool page *is* a picture of five positions.
  Extra people (a second mid, a substitute) still get their own column next to their role.
- **The set of columns is the roster *plus* any member who already has a pool.** A captain creates
  roster rows, but a pool belongs to the person and can be saved before that row exists; hiding it
  would mean "your work does not count until the captain gets round to you". Such a column takes the
  player's own `preferredRole` as its position, which is exactly where it will sit once the row
  appears — the *to-be* place, not a queue at the end. Ordering inside every list is by `position`
  (dense, rewritten per write), never by insertion time or by champion id.
- **Three bands per column, stacked**: `Main`, `Situational`, `Blind-pickable`. Each band is a
  wrapping strip of champion chips in **priority order** (left = first answer), not a fixed grid of
  cells — a 3-champion pool and a 12-champion pool look different, and neither shows dead slots. The
  blind band carries its own heading and nothing else; that is the whole legend, no coloured border
  to decode. (A first-pick glyph was planned here and **not built** — the heading is enough, and an
  icon that means "blind-pickable" in a band already titled that way is decoration.)

```text
        TOP · Jan        JUNGLE · Ben      MID · Flo       BOT · …      SUP · …
 main   [Sion][Ornn]     [Viego]           [Ahri][Vex]      …            …
                         [Jarvan][Sej.]
 situ   [Poppy]          —                 [Kassadin]       …            …
 blind  [Sion][Karma]    [Jarvan]          [Ahri]           …            …
```

- **Width, not depth**: three bands × five columns stays inside the page width at a normal laptop
  size because a band is chips that wrap within its column. If a column gets taller than the screen,
  that is the pool saying something — it is not a reason to paginate.
- **One column is yours**: only that column grows drag handles and an `+` chip; the other four are
  plain reads (§8). The affordance matches the guard before any request is sent.
- **Cells**: **icon only**, from the champion cache (`GET /api/champions`, already shipped) — the name
  is the chip's `title`/`aria-label`, never text next to it. Unknown ids still render as the
  placeholder `ChampionLabel`/`ChampionIcon` do. Chips are **56px with a 4px gap**, which puts four
  on one row of the five-column page — and that only holds because the page is **90rem** wide: at
  72rem a column has ~190px of content and the fourth chip wraps. Width and icon size are one
  decision, not two. At 24px a chip was a colour, and the name beside it doubled every chip's width
  in a strip that should be scanned by picture. The first attempt wrapped icon + name in an
  `ActionIcon` (a fixed square) and clipped the icon to a sliver — wrap content in an
  `UnstyledButton`, never in a fixed-size button.
- **Adding is a popover, never a modal.** The `+` at the end of a band opens a one-column, scrolling
  list anchored next to it, with a search field on top and a **48px** icon per row (the picker keeps
  its names: a list of 170 bare icons is not searchable). It opens on **every** champion, not a page
  of them: a truncated initial list reads as "the rest are missing", and the search field exists to
  narrow the list, not to reveal it. A modal takes the page away and covers the pool being edited —
  exactly what §7 says not to do. Options already in that list are shown disabled, not hidden.
- **This page is the best smoke test for that cache**: it is nothing but names and icons, so a
  regression in the dump integration is visible at a glance instead of buried in a stats table.
- **The drop target is shown, not guessed.** While dragging, the chip under the pointer grows a line
  on its left edge — the champion lands *there*, pushing it right — and a band with no chips gets a
  dashed outline. The dragged chip drops to 35% opacity. Collision is **pointer-first**
  (`pointerWithin`, with `closestCenter` only as the keyboard fallback): with `closestCenter` the band
  container often won over the chip under the cursor, which made a drop append instead of landing at
  the index and left the drag with no feedback at all.
- **Throwing a champion away is a drop, not a menu item.** While something is being dragged, a
  dashed strip appears **under the grid**, as wide as the grid and `sticky bottom` so a tall pool
  keeps it reachable; dropping a chip on it removes that champion from the band **it was grabbed
  in** — dragging the blind copy of a main-pool champion discards only the blind copy (§6). It sits
  in the page flow rather than a fixed viewport corner: a bin at the screen edge is a long drag on a
  wide page and belongs to no table in particular. This is why the `DndContext` sits on the page instead of inside the column: a
  droppable outside the column is unreachable from a chip that belongs to another context. The
  decision (trash wins, else the landing target, else nothing — and **no version bump** for a drop
  that moved nothing) is `applyDrop` in `lib/pools/drag.ts`, unit-tested.
- **Actions are a right-click at the pointer, and they close themselves.** The chip is both the drag
  surface and the menu target: left button drags (dnd-kit holds the pointer), **right button** opens
  the actions **at the `contextmenu` event's coordinates**, clamped to the viewport. The panel closes
  when the pointer leaves it, on Escape, on a pointerdown anywhere else, and on scroll/resize — the
  four things a person does next. Keyboard: **Shift+F10** opens the same actions anchored to the
  chip's box; Enter/Space belong to dnd-kit's keyboard drag.
- **Not a `Menu`.** Two bugs came from anchoring a Mantine `Menu` to the chip: it rendered at the
  page's top-left (the anchor was a component that could not forward its ref, so there was no rect
  to measure) and it stayed open until something else closed it. The panel is a portal with fixed
  coordinates from the event; the corner-dots button before it was a workaround for the same
  click/drag conflict and made the chip look like it had a badge. The action list itself lives in
  `lib/pools/chip-actions.ts` (pure, tested), so the panel only renders and applies.
- **Reordering is drag *and* keyboard**, both producing one ordered array for one `PUT`. Drag uses
  `@dnd-kit/core` + `@dnd-kit/sortable` (the one dependency this feature added): chips are sortable
  nodes, each band is also a droppable so an empty band can receive a champion, and the pointer
  sensor needs 6px of movement so the chip's corner menu stays clickable. The keyboard path is the
  chip menu's move up/down — a real menu item, not a hover affordance — so the page is usable
  without a mouse; dnd-kit's keyboard sensor covers the same ground during a drag.
- **A drag id carries its band** (`chip:<kind>:<championId>`, `band:<kind>`). A champion may sit in
  `main` *and* `blind` (§6), so a bare champion id would let a drag of the blind copy move the pool
  copy. What a drop *means* lives in `lib/pools/drag.ts` (pure, tested): on a chip → land at that
  position, on a band → append, on itself or on nothing → unchanged (and no version bump).
- **Cross-kind drag** (main → situational) is supported, because it is the same gesture the user
  already makes; into `blind` it *adds* a second opinion instead of moving, exactly like the menu.
- **"Stand: aktualisiert vor 3 Tagen"** per column, from the `pool` header. A pool is an opinion;
  when it was last touched is part of reading it correctly.
- **Empty is a state, not an error**: a player with no pool says "no pool yet", and the header
  carries a completion line ("3 of 5 filled their pool") — the same chase-list thinking as
  `availability-planner.md`, one line here, no separate page. It is shown to **everyone**, not only
  the captain: the person who has not filled theirs is the one who should see the nudge, and hiding
  it from members would make the line a secret scoreboard.
- **Fast and cheap to re-read**: this page gets opened during champ select on a second screen. No
  spinner chain, no modal — it is a static read over ~60 champion chips.

## 8. Permissions

| Action | Guard |
| --- | --- |
| read every pool of the team's roster | `member` |
| write your own three lists | `member` (or even team-less: the pool is personal) |
| write someone else's | **structurally impossible** — `PUT /api/pools` has no owner in the path or the body |

Because the write cannot name another owner, the guard is the address. `canEditPool(me, ownerId)`
lives in `packages/shared` anyway, unit-tested, because the **page** has to answer "may I edit this
column?" before the 403 would — same shape as `canEditAvailability` and `claimInvite`.

**Note the deliberate asymmetry** with `player-profiles.md`: the captain owns the roster (note, active,
team role), the player owns their profile *and* their pool. A captain who "fixes" a teammate's pool has
changed a statement of intent, which is not a typo to be corrected.

## 9. Interfaces to the other ideas

- **`match-history.md` §8 (champion stats)** consumes pool membership: `WR-BASIS: nur Pool-Champs`
  becomes `partitionByPool(statsRows, poolChampionIds)`, with the basis selectable (main /
  main+situational). The pools doc provides the ids; the stats doc computes the numbers. Neither
  imports the other's tables.
- **`drafter.md`** reads the three lists per player: the hint list's "pool star" is `main`, the
  "can we first-pick it" note is `blind`. It must read them as *opinions*, never as availability.
- **`hexserve-champion-data.md`** supplies the name/icon per `championId` and, optionally,
  `positions[]`/`roles[]` as a *hint* ("this is normally MIDDLE"). Use it to flag an odd pick, never to
  reject one — the pool is intent, not compliance (§10.7).

## 10. Open questions

1. **Caps.** Decided 2026-11-25: **15 per list**, enforced in the shared validator and in the UI. The
   sheet's grid implied ~10 main / ~4 situational; 15 is the sanity bound that stops a paste from
   blowing up the layout without ever rejecting a real opinion. Soft guidance in the UI may come
   later; the hard bound does not need to change.
2. ~~Does the general/team blindpick list need sides?~~ **Void** — both the team list and the side
   split are gone (2026-11-25).
3. **Can a champion be in main *and* situational?** Decided 2026-11-25: **no** — one pool per
   champion, a move is a `kind` change (§6).
4. ~~Who edits the team blindpick list?~~ **Void** — no team-owned list (2026-11-25). Every write is
   owner-only.
5. **Per-entry note** ("gut gegen Tanks", "nur mit Engage-Support")? It is the most valuable thing a
   pool can carry for a scrim conversation, and the user explicitly asked for name + icon only. v1: no.
   Revisit after the first month of real use, not before.
6. **Do slots carry meaning?** Position is priority. If the team wants "this works as first pick but
   not second", that is a slot enum on the entry — say so before the UI hardens around ordering.
7. **Do we reject a pick outside the champion's usual role?** No (intent, and off-role picks win
   games) — but do we *show* a hint? Recommendation: a subtle marker, never a blocker.
8. **What happens to a pool entry for a champion that patches away** (removed/reworked id, or a patch
   the dump has not ingested yet)? Never auto-delete and never reject the write: render it as unknown
   and let the owner clean it up. Deleting someone's intent on a patch bump is the kind of silent data
   loss that is invisible until it is embarrassing — the same rule `hexserve-champion-data.md` §7
   states from the dump's side.
9. **Mobile?** The page is read mostly on a second screen, but drag-and-drop on touch is a different
   implementation. Read-only on small screens with a "bearbeiten" mode is the honest cheap version.
10. **Does a substitute have a pool row?** Yes — `Sub · Flo` is in the sheet for a reason. Confirm they
    are ordinary roster rows in the render (§1).

## 11. Testing — what actually exists

| Layer | What is covered |
| --- | --- |
| unit (`packages/shared`) | `canEditPool` (own / other / captain-of-other / null); `moveEntry` incl. same index and out-of-range; `validatePoolWrite` (duplicate within a kind, main↔situational conflict, blind overlap allowed, cap 15, ids must be positive integers, unknown ids allowed); `emptyPoolLists` |
| unit (`apps/api`) | `composePools`: a never-saved player is present with `version: 0`; lists ordered by `position` however the rows arrive; a cleared pool keeps version and `updatedAt`; entries of a non-roster owner are ignored |
| unit (`apps/web`) | `poolAgeText` / `poolCompletion` / `hasAnyChampion`; `addChampion` / `removeChampion` / `moveWithin` / `moveAcross` / `moveAcrossAt`; `dragMove` / `dropTrash` / `applyDrop` / id parsing; `chipActions`; `searchChampions` + normalisation; `poolColumns`; `save-queue` (coalescing, version chaining, a read during a write, failure stops the chain, saving state) |
| integration (`apps/api`) | the schema (deferred position constraint proven by removing the qualifier — both reorder tests fail without it, `23505`/`23514`/`23503` cases); `GET`: 401, 404 for non-members, roster order, empty pools, isolation between people, a member with a pool but no roster row; `PUT`: 401, first write, both-direction reorder, cross-kind move leaves one row, clearing one kind, stale `version` → 409 **and nothing written**, 422s, a forged `ownerId` writes the caller only |
| page (`apps/web`, happy-dom) | five role slots incl. empty ones; icon-only chips with the name as label; only my column is sortable; the picker popover searches and autosaves; the action panel opens at the pointer, closes on mouseleave and Escape; a menu move autosaves with the version read; a 409 drops the draft and refetches |

**Not covered, on purpose or for now:** a *real* drag gesture, the trash drop and the Shift+F10 menu
are not simulated in happy-dom — dnd-kit's pointer pipeline is not reproducible there, so the rules
behind them are unit-tested and the gestures are not. Touch behaviour is likewise verified by
`touch-action: none` and dnd-kit's sensors, not by a test.

The end-to-end case that mattered — **two players, one pool each, one reorders and the other's view
changes** — is the integration test "a saved pool reaches everyone in the shared order" plus "everyone
sees the reordered list".

## 12. Decided while implementing (2026-11-25)

These were not in the plan above, or were planned differently. They are the code's "why?":

1. **Autosave, not a Save button.** Every gesture is a complete statement about the pool, so it is
   written immediately. The risk this created — two gestures overlapping — is handled by a
   **serialized queue** (`lib/pools/save-queue.ts`): one request at a time, newer edits replace the
   single queued payload, each request uses the version the previous one returned. A `409` can
   therefore only mean *somebody else* wrote first. The page shows "saving…" and nothing else.
2. **The chip's actions are a right-click at the pointer**, not a corner button and not a `Menu`.
   A `Menu` anchored to the chip rendered at the page's top-left (the anchor could not forward a ref)
   and never closed; the panel is a portal at the `contextmenu` coordinates, closing on mouseleave,
   Escape, outside click and scroll. Keyboard: Shift+F10.
3. **The trash bin is a strip under the grid**, not a fixed corner — and it forced the `DndContext`
   up to the page, because a droppable outside a column is unreachable from that column's context.
   Which *copy* of a champion goes is decided by the band in the drag id (`applyDrop`).
4. **`@dnd-kit/core` + `sortable`** was added as the feature's only dependency: pointer, touch and
   keyboard sorting, plus the transform animation that made the drag stop feeling janky. Collision is
   **pointer-first** (`pointerWithin`, `closestCenter` only for keyboard): with `closestCenter` the
   band container beat the chip under the cursor, so drops appended instead of landing at an index.
5. **The five role slots are always drawn**, empty ones as a dashed "no player yet" column, and the
   column set is the **roster ∪ members who already have a pool** (a pool can exist before its roster
   row does). Both come from the same thought: the page is a picture of five positions, and nobody's
   work should be invisible.
6. **Chips are icon-only at 56px**, four to a row at the page's 90rem width. The first version put
   icon + name in a 30px `ActionIcon` and clipped the icon to a sliver; the page width and the icon
   size are one decision, not two.
7. **No `partitionByPool`** and no `drafter` consumer were built here — they belong to
   `match-history.md` and `drafter.md`, which read the ids this feature stores.
8. **Skipped on purpose:** per-entry notes (§10.5), a role hint for off-role picks (§10.7), soft cap
   guidance, and a read-only-on-mobile mode.

## 13. Where this ended — 2026-11-25

Green: `bun run test`, `bun run test:db`, `bun run typecheck`.

- **Shared:** `canEditPool`, `moveEntry`, `validatePoolWrite`, `POOL_CAP`, `emptyPoolLists`.
- **API:** `GET /api/teams/:slug/pools` (roster order, empty pools present, members with a pool but
  no roster row included) and `PUT /api/pools` (owner from the session, whole pool, atomic, `409` on
  a stale version). Migration 0016 is additive, and its position constraint is hand-edited to
  `DEFERRABLE INITIALLY DEFERRED` — drizzle cannot express it, and a test fails if the qualifier is
  ever dropped.
- **Web:** the pool page (five role slots, three bands, 56px chips), the champion picker (popover,
  one column, whole cache on open), drag + right-click actions + trash, and autosave with its queue.
- **Left for later:** a cross-pool search ("who plays Yone?") — the obvious next question on this
  page during champ select, and not written down anywhere yet.
