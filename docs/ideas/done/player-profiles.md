# Idea — player-owned profiles, captain-owned roster

**Status:** done — 2026-11-21. Landed across `07b29a9`…`ab47c91`: the split (`profile`,
`riot_account`, `roster_entry`), the player's own profile and accounts (routes, hooks, the
`/profile` page with autosave), the blocking first-login gate, the roster read as a join with the
captain picking team members instead of typing them, per-entry account choice and `roleOverride`,
and `player` dropped. **Riot validation (§4) was not built here** and moved whole to
[`riot-api.md`](riot-api.md), which landed on 2026-11-21: an account is resolved on save, `puuid` is
required, and the unverified rows this release wrote were deleted by that idea's migration `0010`.
**Companion to:** `multi-team.md` (tenancy). This doc is about *who owns which field*.
**Decisions taken while implementing:** §10.

## 1. The idea

On first login a player fills in their own details:

- **display name** (default: their Discord name)
- **one or more League accounts** (Riot ID = `gameName#tagLine`), with exactly one marked **main**
  — the account used for the real Prime League games
- **favourite role** (TOP / JGL / MID / ADC / SUP)
- later, editable at any time

The roster is then built *from people who joined and filled this in*: a captain picks from that
pool, and adds the note (as today). Because the roster renders from the player's own row, a later
edit shows up in the team automatically — no sync step, by construction.

## 2. The real problem: two owners for one row

Today `player` is **100% captain-owned**. Every write in `routes/players.ts` is `{ captain: true }`.
This idea gives the same fields a *self-service* owner, which is a genuine change of shape, not an
addition:

| Field | Today | Wanted |
| --- | --- | --- |
| `displayName` | captain | **player** |
| `riotGameName` / `riotTagLine` | captain | **player** (plural, one main) |
| `role` (position) | captain | **player** as *preference*; captain may override for the roster |
| `note` | captain | **captain** |
| `isActive` (on the roster) | captain | **captain** |

Two owners over one row is where these features usually rot: per-field authorization is invisible,
and a self-service `PATCH` that spreads `...body` into the update can silently rewrite `note`.

### Recommended: split the row

```text
profile          id, userId → user (UNIQUE), displayName, preferredRole,
                 updatedAt
riot_account     id, userId → user, gameName, tagLine, platform, isMain,
                 puuid, summonerLevel, profileIconId,      ← from Riot on validation
                 rankTier, rankDivision, rankQueue,        ← snapshot, nullable
                 verifiedAt, fetchedAt, createdAt
                 UNIQUE (userId, gameName, tagLine)
                 partial UNIQUE (userId) WHERE isMain   ← exactly one main, DB-enforced

roster_entry     id, teamId → team, userId or profileId, note, teamRole,
                 isActive, createdAt
```

- **profile / riot_account = player-owned.** Routes guard with `{ auth: true }` — a *pending* user
  must be able to fill this in, which is a new class of route (today every write needs `member` or
  `captain`).
- **roster_entry = captain-owned**, as today.
- The roster page is a **join**: `roster_entry ⋈ profile ⋈ main riot account`. The "changes
  propagate automatically" property is then not a feature to build — it's the absence of a copy.
  Honestly the strongest argument for the split.

Alternative kept on the table: one `player` row with a per-field permission table. Less code today,
but every future field re-litigates "can the player write this?", and the failure mode is a silent
privilege escalation. I'd skip it.

## 3. Multi-account details

- **One main, enforced in the DB.** Partial unique index (`WHERE is_main`) rather than a
  `mainAccountId` on `profile` — the latter allows a dangling or missing main across two updates.
- Changing the main = a transaction (unset old, set new), not two independent requests.
- Deleting the main **promotes the oldest remaining account** in the same transaction: the unique
  index can only say "at most one", and "has accounts but no main" would silently break the roster
  join later (§10).
- **Riot ID is a display string, not an identity.** Renames change it. Because validation calls
  Riot anyway (§4), `puuid` is **required** on insert — it is the stable key for renames and for
  every later lookup. `gameName#tagLine` is the label, `puuid` is the identity.
  *While validation was unimplemented `puuid` was nullable; it became `NOT NULL` in `0010`
  (2026-11-21), together with deleting the rows that had no puuid (`riot-api.md` §12).*
- **`platform` is required** (`euw1` default). It decides which host serves the summoner and rank
  calls; an account without a region cannot be resolved at all (§4).
- Validation limits (game name / tag length, allowed characters) must be taken from Riot's current
  rules — **verify against the live docs rather than copying numbers from memory.**

## 4. Riot API validation (server-side)

**The client, the endpoint chain, the rate budget and the error mapping are their own idea:**
[`riot-api.md`](riot-api.md). This section keeps only what the profile row needs from it: the two
endpoints, `verifiedAt`, and the "degrade, never block" rule — which `riot-api.md` §12 later
**reversed**: a save Riot cannot answer is refused, because a row without a `puuid` no longer
exists.

Typing `Hide on bush#EUW` proves nothing. Resolving it against Riot proves the account **exists**,
and hands us a level, an icon and (cheaply) a rank — enough for the player to recognise their own
account and catch a typo before it reaches the roster.

### The endpoint chain, and why region is mandatory

Riot splits its API across **two different host families**, and you cannot mix them:

| Step | Endpoint | Host | Gives |
| --- | --- | --- | --- |
| 1 | `GET /riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}` | **regional** (`europe`, `americas`, `asia`, …) | `puuid` |
| 2 | `GET /lol/summoner/v4/summoners/by-puuid/{puuid}` | **platform** (`euw1`, `eun1`, `na1`, `kr`, …) | `summonerLevel`, `profileIconId` |
| 3 | `GET /lol/league/v4/entries/by-puuid/{puuid}` | **platform** | `queueType`, `tier`, `rank`, `leaguePoints` |

Step 1 needs only the Riot ID. Steps 2–3 need the **platform**, which is why the region is not
optional: without it we can confirm the account exists but show nothing about it. Store the platform
code (`euw1`) and derive the regional group from a static map — never store both, they can drift.

Verify the exact routing values and payload shapes against the live docs before implementing; the
shape above is current as of this writing, and Riot has removed fields before (the legacy
`summonerId` is already gone).

### The client is injected, like `db` and `auth`

```text
apps/api/src/riot/client.ts   RiotClient interface: resolveAccount(), getSummoner(), getRank()
                              createRiotClient({ apiKey, fetch })  ← real
                              createFakeRiotClient({ ... })        ← tests
```

`createApp({ db, auth, riot })`. Same reason as everything else in this codebase: the tests must be
able to answer "404", "429" and "timeout" without a network. The key is a **server secret** — the
SPA never talks to Riot (it would leak the key and hit CORS anyway).

### Two endpoints

- `POST /api/riot/lookup` `{ gameName, tagLine, platform }` → `{ puuid, gameName, tagLine,
  profileIconId, summonerLevel, rank? }`, guard `{ auth: true }`. This is the instant check.
- On profile save the server **re-resolves** and writes the snapshot. Never trust a client-supplied
  `puuid`/rank — otherwise the client can claim any account.

### Error mapping (each one is a different sentence to the user)

| Riot | Meaning | UI |
| --- | --- | --- |
| 404 | no such Riot ID **or wrong region** | "Check name, tag and region" |
| 400 | malformed name/tag | inline field error |
| 429 | rate limited | "Try again in a moment" + honour `Retry-After` |
| 403 | key invalid/expired | feature unavailable — **do not block saving** |
| timeout | network | same as 403 |

### The rate budget is the real constraint

A development key allows **20 req/s and 100 req/2min**, and **expires every 24 hours**. Three calls
per account means ~33 validations per two minutes for the *whole server*. Therefore:

- check on an explicit **"Check" button or on blur**, never per keystroke;
- per-user throttle, so one person cannot burn the team's budget;
- cache the snapshot with `fetchedAt`; refresh on demand, not on page render.

### Degrade, never block

If the key is missing, expired, or rate-limited, saving must still work — the account is stored with
`verifiedAt = null` and shown as **unverified**. A 24-hour-expiring dev key that hard-blocks
onboarding would break the app every morning.

### Validated ≠ verified

Step 1 proves the account exists, not that it is *theirs*. Options: accept the risk (a captain knows
their team), a profile-icon challenge (the tournament-style proof of ownership), or Riot Sign On
(needs Riot approval). See §9.

### Testing

Fake client + pure mapper: `toRank(entries)` → `{ tier, division, queue }` unit-tested against
recorded payloads, including "unranked" (empty array) and a queue we don't care about. Cases to pin:
404, 429, 403, timeout, malformed body. Note this is what finally gives `TIERS`, `DIVISIONS` and
`QUEUES` in `packages/shared` a purpose — see the caveat in `quick-wins.md` A3.

## 5. Onboarding flow

```text
Discord login → /welcome (first time)
   display name (prefilled from Discord)
   + riot accounts, one marked main
   + favourite role
   → saved → then the existing pending/approval screen
```

- Gate: **`{ auth: true }`**, not member — otherwise a pending user can never complete onboarding
  and the whole flow deadlocks.
- "Profile complete" should be **computed** (`displayName && ≥1 riot account && preferredRole`),
  not a stored boolean. A stored flag goes stale the moment an account is deleted. Implemented as
  `missingProfileFields` in `packages/shared`, read by the profile page, the setup gate and (later)
  the captain's picker — one rule, several readers. **The birthday is not part of it** (§10).
- Skippable? **No — decided against** (§10). A roster entry is a *member* now, so a player without
  a profile cannot be picked by their captain at all; a skip would only move the confusion to the
  captain. `/welcome` is blocking, and no separate nudge is needed because nothing else is
  reachable until it is done.

## 6. Captain's roster flow

Picking from team members with complete profiles:

1. Captain opens roster → "Add from team" (instead of typing a player from scratch).
2. Sees members with a complete profile: name, main Riot ID, preferred role.
3. Adds → creates `roster_entry` with the note and (optionally) a role override for the team.

~~Free-typed roster entries (someone without an account yet) should probably stay possible — that's
why `roster_entry.userId` is nullable, mirroring today's nullable `players.userId`.~~
**Reversed while implementing** (§10): a roster entry is always a **member** of the team.
`userId` is `NOT NULL`, and a composite foreign key onto `membership (teamId, userId)` with
`ON DELETE CASCADE` makes that a database fact rather than a route convention. The flow is
therefore invite → join → add to roster, and the captain picks from `GET /members` instead of
typing a name.

## 7. UI touch points

- `AppLayout.tsx` user menu: email + **"My profile"** + **Log out**. Shipped — and the `captain`
  badge next to the email was **removed** (§10): captaincy is per team now, and the switcher already
  names the team you lead.
- New page `/profile` (or `/welcome` when incomplete) reusing the roster form fields, minus the
  captain-only ones.
- Profile form: **region select (EUW default)**, name + tag, a **Check** button, and the resolved
  card — icon, level, rank, "unverified" badge when the lookup was unavailable.
- `badges.tsx` grows a "main account" marker in the roster table.

## 8. Naming hazards

- `player.role` today means **position**, while `user.role` means **captain/member**. In the new
  model: `profile.preferredRole` (position) vs `membership.role` (permission). Keep the two words
  visibly different in code, or the next reader will mix them up.
- `PlayerDto` becomes a composite (`profile` + `roster_entry` + main account). Rename it rather
  than mutate its meaning.

## 9. Open questions

1. **Validated vs verified.** §4 proves the account *exists*; it does not prove the player *owns*
   it. Decide: accept the risk (a captain knows their team), a profile-icon challenge, or Riot Sign
   On (needs Riot approval).
2. **Is the profile global or per team?** With `multi-team.md`'s membership model: **global** — one
   profile, one roster entry per team. Confirm.
3. Can a captain **edit** a player's stated role on the roster (`teamRole` override), or is the
   preference authoritative?
4. What happens on **leaving a team** — roster entry deleted, profile kept? (Should be yes.)
5. Do we ever need accounts **beyond LoL** (Riot's other games)? Assume no, keep it Leagues-shaped.
6. Prime League specifics: do we need to record the **roster lock date** / registered squad, or is
   "main account + note" enough for v1?

## 10. Decided while implementing (2026-11-21)

### What shipped

| Area | Where |
| --- | --- |
| `profile` (one per user, `userId` UNIQUE) | migration `0005`, `GET/PUT /api/me/profile` |
| `riot_account` (several, ≤1 main) | migration `0005`, `GET/POST/DELETE /api/me/riot-accounts`, `PUT …/:id/main` |
| `roster_entry` (captain-owned, member-only) | migration `0006`, `GET/POST/PATCH/DELETE /api/teams/:slug/roster` |
| the split of the old `player` rows | migration `0006` backfill: profile ← name/role, account ← Riot ID, entry ← note/active/override |
| `player` removed | migration `0007` (`DROP TABLE`); the old `/players` route, `PlayerDto` and `usePlayers` are deleted |
| first-login gate | `/welcome`, blocking, `RequireCompleteProfile` around every member route |
| the roster as a join | `composeRoster` in `apps/api/src/lib/roster.ts`, unit-tested; four reads, not one SQL join |

### Decisions, with the reason they were made

1. **A roster entry is always a member** (`userId NOT NULL`, composite FK → `membership`). "A player
   comes from the team's members" is a constraint, not a check a future route could forget.
   Consequence accepted: no typing a name before the person joins.
2. **The first-login page is blocking, not skippable.** With (1) in place an incomplete profile
   means a captain cannot use you; letting someone wander off would hide that, not spare them.
3. **The birthday is optional and nullable.** Personal data: forcing it invites fake dates. It is
   therefore **not** part of `missingProfileFields`, and a birthday list simply skips whoever
   declined.
4. **`preferredRole` stays `NOT NULL` on `profile`**, because a profile only exists once the
   blocking page has asked for it. A missing position on the roster therefore means *no profile
   yet* (`role: null`, rendered `unassigned`) — never a profile without a role.
5. **`platform` is fixed to `euw1`** until Riot validation exists. A region select would be a label
   nobody can check; it becomes meaningful in the same patch as the lookup.
6. **Deleting the main account promotes the oldest remaining**, in one transaction under a row lock
   on the player. "At most one main" is the index; "always one while accounts exist" is this.
7. **`hasPlayer` → `hasRosterEntry`** on the member list: after the split, "on the roster" is the
   fact that exists, and the old name described a table that no longer does.
8. **Unverified is a neutral badge, not an error.** Every account is unverified today; the app must
   be fully usable that way — which is also its state whenever the Riot key is missing or expired.
9. **The roster is composed from four queries, not one SQL join.** `roleOverride ?? preferredRole`
   and "only the main account" are rules; in SQL they would be untestable here. This is the one
   place a join was *deliberately* not written as a single statement.

### Deferred — carried elsewhere, not part of this idea

This doc is closed because the ownership split shipped. What is left was never a gap in the split;
recorded so the next reader does not think it was forgotten:

- **§4 in full** — the Riot client, endpoint chain, rate budget and error mapping. Own idea:
  `../integrations/riot-api.md`. Until then `verifiedAt` is always `NULL` and `platform` is `euw1`.
- **`puuid` becomes `NOT NULL`** in the patch that can fill it, together with that lookup. The
  column stays nullable on purpose, not by accident (§3).
- **The captain's picker lists every member**, not only those with a *complete* profile. That is the
  §6 flow minus a filter: when it matters, `missingProfileFields` is already the rule to filter by.
- **§9.1, §9.5, §9.6 remain open questions**, not commitments: validated vs verified (Riot Sign On
  or a profile-icon challenge), non-LoL accounts, Prime League roster locks. §9.2 (global profile)
  and §9.3 (captain override) are decided: global, and yes — `roleOverride`.
