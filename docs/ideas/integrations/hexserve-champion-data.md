# Idea — champion & patch data from our own dump (Hexserve)

**Status:** idea, nothing implemented.
**Used by:** `champion-pools.md` (name + icon per pool cell), `match-history.md` (champion names/icons
in the games list and the stats table, and the `WR-BASIS` numbers next to them).
**Supersedes:** Data Dragon and hardcoded champion tables in this repo.

## 1. The idea

The team already runs a per-patch dump at **`https://hexserve.dump-collector.de/`**, refreshed as soon
as a patch lands — so on any given day it holds the current patch. It is DDragon-shaped, so it replaces
Data Dragon outright:

- **always current**: the names and icons shown are the ones live now, which is what the official
  client shows in match history too (§4);
- **German names are available** (`de_DE` next to `en_US`) — the UI is German, the champions should be
  too;
- **it is ours**: no third-party rate limit, no field silently removed between patch notes.

**Decision, and it shapes everything below: we keep the current patch and the one before it — and
nothing else.** Patches are ~2 weeks apart, so two versions cover a whole release cycle of games for
~340 rows of data; anything older renders with current labels and nobody minds (§4).

The counterweight, stated once and answered in §7: it is one host that we also run. No SLA, so nothing
may *depend* on it being up at render time.

## 2. What it serves (verified against the live host)

| Path | Gives |
| --- | --- |
| `/version.json` | `{ version, lastUpdate, timestamp, history: [{ version, lastUpdate, timestamp }] }` — one small GET answers "is there a new patch?" and lists every patch that exists |
| `/<patch>/<locale>/champion-index.json` | `{ version, locale, totalChampions, champions: [{ id, key, name, slug, iconUrl, attackType, resource, releaseDate, releasePatch, patchLastChanged, positions[], roles[] }] }` |
| `/<patch>/<locale>/champions.json`, `/champions/<Name>.json` | full per-champion stats — `health`, `healthRegen`, `mana`, `armor`, `magicResistance`, `attackDamage`, …, each as `{ flat, percent, perLevel, percentPerLevel }` |
| `/<patch>/<locale>/items.json`, `item-index.json` | same shape for items |
| locales | `de_DE`, `en_US` |
| history depth | observed from `15.21.1` onward — **irrelevant to us**: we read the current version only (§4) |

Two details that look trivial and are not:

- `iconUrl` points at **CommunityDragon** (`raw.communitydragon.org/<major.minor>/…`), *not* back at
  Hexserve — so the SPA currently needs that third host (§9.2);
- the icon path uses **major.minor** (`16.23`), while the directory is the full patch (`16.23.1`). Do
  not derive one from the other by string surgery; store what the dump gives (§4).

## 3. What it replaces, exactly

| Today | After |
| --- | --- |
| `TIERS` / `DIVISIONS` / `QUEUES` style hardcoded vocabulary in `packages/shared` | unchanged — those are our domain, not Riot's champion list |
| Data Dragon URLs composed in the SPA | one stored `iconUrl` per `(patch, championId)` |
| id → name maps in components | one lookup from the cache (§4) |
| nothing | `positions[]` / `roles[]` as a *hint* source ("this champion is normally MIDDLE") |

The rule that keeps this from spreading: **we store ids, we render labels.** No champion name, no icon
URL and no champion "class" is ever written onto a match, a participant or a pool entry — they are
derived at render time from this cache. Same doctrine as `match-history.md` §5: a fact we cannot get
back gets a column, arithmetic does not.

## 4. Two versions retained — and one rule about which label wins

**The cache keeps the current patch and the one before it. Nothing older.** Roughly 340 rows, zero
maintenance, and it covers the window that actually matters: patch day, when tonight's games were
played on yesterday's patch and the dump has already moved on.

Three reasons this is the right size:

- **patches are ~2 weeks apart**, so two versions cover a full release cycle — the retention window is
  the transition window, which is exactly where a missing label would be noticed;
- **a broken publish is survivable.** If a patch's champion set arrives malformed or wrong, the
  previous one is still there to fall back to while it gets fixed (§5 has the sequence);
- **it is bounded.** "Keep the last N" with N=2 is a rule that never grows into an archive, an index
  over thirty directories, or a query per patch.

```text
champion     patch ("16.23.1") + championId → PK (patch, championId),
             name, slug, iconUrl, positions[], roles[], locale,
             fetchedAt
             INDEX (championId)
```

### The rule that keeps two versions from becoming an inconsistency

**Labels always come from the newest retained patch.** The previous patch is a **lookup safety net**,
not a source of labels:

| Situation | Which row |
| --- | --- |
| normal — the id exists in the newest patch | newest patch |
| the id vanished in the newest patch (removed/reworked a champion id, or a refresh that only half-succeeded) | previous patch, same name and icon for **all** rows |
| no row in either (brand-new champion, dump lags) | id + placeholder, never an error |

Why not render each game with *its own* patch, which the retention now makes possible? Because the
variance would land exactly where it hurts: only the newest ~2 weeks of games would show an old name,
and the same champion would change label in the middle of one list — and then silently become
consistent again as the games age out. **The official client shows current champions for old games for
the same reason.** One label per `championId`, always, whichever patch it came from.

- **It is a cache, not a source of truth**, and it is the only cache in this design that earns its
  table (`match-history.md` §5 bucket table): its content is a fixed snapshot, and its invalidation
  trigger has a name — *a new version in `version.json`*.
- **Never invalidate by time.** A TTL would refetch identical data forever; a version comparison is
  free and exact.
- **`match.gameVersion` stays** — it is a Riot fact and a useful label ("gespielt auf 16.21"), which
  now also explains *why* a game is rendered with a newer champion set. It still does not select the
  label.
- **Polling is one small JSON file** and costs nothing from the Riot budget, so it can ride along with
  the hourly job (`match-history.md` §4.1) or its own timer — daily is plenty, because a patch day is
  not a real deadline for a label.

## 5. The refresh rule, and the one real trap

```text
needsRefresh(storedPatches, dumpVersion) → boolean      // pure, unit-tested
retainNewestTwo(history) → [currentPatch, previousPatch]   // pure, unit-tested
```

`version.json` names the current patch; if we do not hold it, one refresh runs — that is the whole of
what used to be a patch resolver. Cases in §10: already held → no, missing → yes, cache empty → yes,
dump unreachable → no (keep what we have).

**Trap #1: never leave the cache empty or half-replaced.** The refresh is
`fetch → parse and validate → insert new patch → delete patches beyond the two newest → commit`, all in
one transaction, never `TRUNCATE` followed by inserts — a page rendered in that window shows every
champion as a bare id, which looks exactly like a broken deploy. If the fetch or the parse fails,
nothing is deleted: the previous patch is still the newest one we hold (§4's safety net, used).

**Trap #2: "newest" is not "largest version string".** `16.9.1` sorts after `16.10.1` as text, and
`16.20.1` before `16.9.1` — a string comparison silently prunes the wrong patch on the next refresh.
Order by `version.json.history[].timestamp` (or `lastUpdate`), never by comparing version strings;
`retainNewestTwo` takes the history array precisely so this cannot be got wrong at the call site.

Three states, and the UI must be able to tell them apart:

| State | Meaning | Render |
| --- | --- | --- |
| `current` | we hold the dump's current patch | names + icons from it |
| `previous` | we are one patch behind (refresh has not succeeded yet) | names + icons from the patch we hold — indistinguishable, one log line |
| `empty` | no cache at all (first boot, or a failed first fetch) | ids + placeholders, pages still work (§7) |

`previous` is the interesting one: the honest move is to **keep showing the labels we have**, because
one patch of drift is invisible while an id-only page is not. That is why the replace is transactional
and why a failed refresh never clears the table.

## 6. Endpoints in the API

- `GET /api/champions` → `{ patch, previousPatch, fetchedAt, state, champions: [...] }`, where
  `champions` is **already flattened to one row per id** (§4's rule, resolved server-side so no client
  can resurrect per-patch labels). Cached by the SPA for the session.
- **No `?patch=` parameter.** The two retained versions are an implementation detail; a parameter would
  turn retention into an API contract, and someone would then ask for the archive.
- **No proxy of the raw dump.** The SPA gets our shaped JSON, not a `champions.json` re-export for
  another client to grow attached to.

## 7. Degrade, never block

The dump is ours, therefore it can be down for reasons that have nothing to do with the app:

| Failure | Behaviour |
| --- | --- |
| Hexserve unreachable, cache populated | serve the cache (state `stale` if the dump was ahead), log once, no user-visible error |
| Hexserve unreachable, cache empty | champion renders as its **id** plus a neutral placeholder box; pages still work (§5) |
| the refresh fails mid-cycle | the previous rows stay; never an empty table (§5) |
| unknown `championId` (new champion, patch not dumped yet) | render id + placeholder; **never** reject or delete data that references it (`champion-pools.md` §10.8, `match-history.md` §6) |

Rendering a label must never be able to fail a page. That is the whole of this section.

## 8. What it must not become

- **not a validation gate.** A pool entry or a match referencing an id this dump does not know is
  accepted and rendered as unknown. A dump that lags a patch by a day must not make yesterday's pick
  unsaveable.
- **not a second source of team data.** No champion notes, no tier lists, no "pool" here. Those are
  human opinions and live with their features (`champion-pools.md`).
- **not the item/stat warehouse yet.** `champions.json` carries full base stats and `items.json` exists.
  Tempting, unused, and every field we read is one we have to keep working after a dump change. Read
  ids, names, icons, `positions[]`, `roles[]` — nothing else until something needs it.
- **not a sync job with a cursor.** There is nothing incremental about a patch: it is one file set,
  replaced whole.
- **not a patch archive.** The dump keeps history; we keep two versions (§4) and the second one is a
  safety net, not a rendering mode. If somebody asks for "the icon as it was in spring", that is a new
  idea, not an extra `WHERE`.

## 9. Open questions

1. **Do we mirror the icons?** `iconUrl` points at `raw.communitydragon.org`. Mirroring onto Hexserve
   removes the third-party dependency for the SPA and costs a rewrite of one stored URL — decide
   whether the SPA may talk to a third party at all (also asked as `match-history.md` §10.13).
2. **Which locale is canonical?** `de_DE` for the UI, `en_US` for anything we ever compare against Riot
   payloads or documentation. Store both, or store one plus a marker? (Recommendation: store the
   locale we render with, keep the other one fetchable.)
3. **Is two enough, and is "one label per id" really preferred over per-game patches?** Four weeks of
   exact labels plus current labels for everything older is the recommendation (§4). The alternative —
   rendering each game with its own patch — is possible on this schema, and rejected for the reason
   written there. Confirm it; it is the only place this design deliberately shows a newer label on an
   older game.
4. **Do we need `champions.json` (full stats) at all?** Today: no. If "damage share vs. champion base
   stats" ever becomes a feature, it is one more read from a cache we already have — until then it is
   dead weight, so don't fetch it.
5. **Are `positions[]` / `roles[]` trustworthy enough to *display* as a hint** ("normally MIDDLE")?
   They come from Riot's own data, but a champion can be played in three roles. Recommendation: hint
   only, never a filter, never a warning colour (`champion-pools.md` §10.7).
6. **Poll cadence for `version.json`**: on the hourly tick, or on demand when a page asks for a patch we
   do not have? The second is cheaper and self-healing; the first makes a new patch visible sooner.
7. **What if Hexserve moves or is renamed?** One base URL in config, not scattered strings — say it
   explicitly, because `dump-collector.de` is a hobby domain and will outlive its name.
8. **Does anything else want the dump** (runes, summoner spells, item sets for a future draft tool)?
   Assume yes eventually; shape the client (`getPatchIndex`, `getChampions`, later `getItems`) so that
   is an added method, not a second client.

## 10. Testing

| Layer | What |
| --- | --- |
| unit (`apps/api`, no HTTP) | `needsRefresh` — held → false, missing → true, empty cache → true, dump unreachable → false (keep what we have); `retainNewestTwo` over a history array whose **string order lies** (`16.9.1` vs `16.10.1`, `16.20.1` vs `16.9.1`) picks the two newest by timestamp. *These live in `apps/api`, not `packages/shared`: the refresh and the state are both resolved server-side (§6), so there is one consumer. Only `PatchHistoryEntry` / `ChampionCacheState` cross the boundary.* |
| unit (`apps/api`, fake HTTP) | the refresh triggers exactly on a not-yet-held `version.json` version and **not** on a poll that returned one we have; a second request in the same session makes zero HTTP calls; a malformed `champion-index.json` leaves both stored patches intact; a third patch deletes the oldest and keeps exactly two; a reader during the replace never sees an empty table — the transaction is the assertion |
| integration | two matches with **different** `gameVersion`s render the **same** name and icon (the §4 rule), while `match.gameVersion` still differs and is shown as a label; an id that exists only in the **previous** patch resolves and renders, and so does every other row referencing it; an id in neither renders as placeholder |
| web | unknown `championId` → id + placeholder, no crash; `stale` and `empty` render distinctly and never block; no rendering path throws when the champion is unknown |

The failure this suite exists to prevent: a page that is blank because a hobby server was restarting.

## 11. Suggested sequencing

Small, self-contained, and everything else wants it — so build it early, before or alongside the first
feature that shows a champion (`champion-pools.md` §12 step 2).

1. **`getVersionIndex` / `getChampions(locale)`** behind an injected client (`createApp({ …, hexserve })`),
   plus a fake. `needsRefresh` and `retainNewestTwo` with their test rows — the string-order trap first,
   because it is the one that fails silently.
2. **`champion` cache table + the transactional replace and prune** (§5), with the "never empty" test.
3. **`GET /api/champions`** returning the flattened one-row-per-id list plus `state`.
4. Swap the SPA's champion rendering to it — in `champion-pools.md` first, because that page is nothing
   but names and icons, so a regression is immediately obvious.
5. Only then: `match-history.md`'s games list and stats table consume the same endpoint. Nothing there
   changes but the lookup.
