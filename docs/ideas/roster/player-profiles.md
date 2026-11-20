# Idea — player-owned profiles, captain-owned roster

**Status:** idea, nothing implemented.
**Companion to:** `multi-team.md` (tenancy). This doc is about *who owns which field*.

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
- **Riot ID is a display string, not an identity.** Renames change it. Because validation calls
  Riot anyway (§4), `puuid` is **required** on insert — it is the stable key for renames and for
  every later lookup. `gameName#tagLine` is the label, `puuid` is the identity.
- **`platform` is required** (`euw1` default). It decides which host serves the summoner and rank
  calls; an account without a region cannot be resolved at all (§4).
- Validation limits (game name / tag length, allowed characters) must be taken from Riot's current
  rules — **verify against the live docs rather than copying numbers from memory.**

## 4. Riot API validation (server-side)

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
  not a stored boolean. A stored flag goes stale the moment an account is deleted.
- Skippable? A player who wants to look around first shouldn't be trapped. Suggest: skippable, but
  the roster pool only shows complete profiles. That makes "complete your profile" self-motivating
  instead of a hard gate.

## 6. Captain's roster flow

Picking from team members with complete profiles:

1. Captain opens roster → "Add from team" (instead of typing a player from scratch).
2. Sees members with a complete profile: name, main Riot ID, preferred role.
3. Adds → creates `roster_entry` with the note and (optionally) a role override for the team.

Free-typed roster entries (someone without an account yet) should probably stay possible — that's
why `roster_entry.userId` is nullable, mirroring today's nullable `players.userId`.

## 7. UI touch points

- `AppLayout.tsx:49` user menu: currently email + status badge + **Log out**. Add
  **"My profile"** (and, once teams exist, **"Switch team"**). Same menu, one new item.
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
