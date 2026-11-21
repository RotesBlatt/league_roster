# Idea — the Riot API is one injected client, not a fetch in a route

**Status:** idea, nothing implemented. **Decided 2026-11-21:** direct — this API calls Riot with
its own production key; Hex-Tractor is not a dependency (§10). **Typing decided:** generated wire
types from a pinned community spec, narrow TypeBox schemas at runtime (§2.1).
**Used by:** `player-profiles.md` §4 (validate a Riot ID, snapshot level/icon/rank) and later
`match-history.md` §4 (match-v5, tournament-v5 — same key, same budget).
**Not the same thing as:** anything about *ownership* of an account. This doc answers "can the server
talk to Riot, and what does it do when Riot says no?". Whether "the account exists" also means "it is
yours" stays in `player-profiles.md` §9.1.

## 1. The idea

One module owns everything Riot-shaped:

```text
apps/api/src/riot/client.ts
  RiotClient        resolveAccount(), getSummoner(), getRank()      ← the only interface the app sees
  createRiotClient({ apiKey, fetch, timeoutMs })                    ← real HTTP
  createFakeRiotClient({ ... })                                     ← tests, no network
  RiotError         discriminated union: not_found | bad_request | rate_limited
                    | forbidden | unavailable | timeout
```

`createApp({ db, auth, riot })`, exactly like `db` and `auth`. The reason is the same reason those
are injected: a test must be able to answer `404`, `429`, `403` and "the socket hung" without a
network call, and a route must be unable to reach the network except through this seam.

Three rules that fall out of it, and each one is cheaper to keep than to retrofit:

- **Routes never build a URL.** `routes/` calls `riot.resolveAccount(...)`; the host, the path and
  the header live in one file.
- **Routes never read a Riot payload.** The client returns our shapes (`{ puuid, gameName, tagLine }`,
  `{ summonerLevel, profileIconId }`, `{ tier, division, queue }`), never Riot's.
- **A Riot failure is a value, not an exception that 500s.** Each status maps to a sentence the UI
  can show (§6) — or to "no snapshot", which must still save (§5).

## 2. What we call, and on which host

Riot splits its API across **two host families and you cannot mix them**. Getting this wrong is a
404 that looks like "no such player".

| Step | Endpoint | Host | Gives |
| --- | --- | --- | --- |
| 1 | `GET /riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}` | **regional** — `europe`, `americas`, `asia`, `sea` | `puuid`, plus the *canonical* `gameName` / `tagLine` |
| 2 | `GET /lol/summoner/v4/summoners/by-puuid/{puuid}` | **platform** — `euw1`, `eun1`, `na1`, `kr`, … | `summonerLevel`, `profileIconId` |
| 3 | `GET /lol/league/v4/entries/by-puuid/{puuid}` | **platform** | one entry per ranked queue: `queueType`, `tier`, `rank`, `leaguePoints`, `wins`, `losses` |

Consequences worth stating, because they are design decisions and not implementation details:

- **The platform is mandatory.** Step 1 needs only the Riot ID; steps 2–3 cannot run without a
  platform code. Without a region we can prove an account exists and show nothing about it, which is
  not what the player typed the account for. So `platform` is stored per account, not derived.
- **Store the platform, derive the region.** A static map (`euw1` → `europe`) in the client. Storing
  both invites drift the first time someone edits one of them.
- **`puuid` is the identity, `gameName#tagLine` is the label.** Renames change the label; every later
  lookup (match-v5 included) keys on the `puuid`. That is why an account row without one is useless
  and `player-profiles.md` makes it required.
- **The rename case is free.** Step 1 returns the current name/tag, so a re-resolve is also how a
  snapshot refresh picks up a rename — no separate logic.

Verify the routing values and payload shapes against the generated spec and recorded fixtures (§2.1)
before implementing. Riot has removed fields before (the legacy `summonerId`/`accountId` are already
gone from payloads), and a payload field that no longer exists is a `null` in the UI, not an error.

## 2.1 Typing: generated wire types, narrow runtime schemas

Riot publishes no official OpenAPI spec (the feature request is still open). The best available
source is the community schema [`MingweiSamuel/riotapi-schema`](https://github.com/MingweiSamuel/riotapi-schema),
regenerated **daily** from Riot's API reference. We generate **types only** from a pinned copy, and
keep runtime validation narrow. Two layers, two jobs — neither replaces the other:

| Layer | Source | Job |
| --- | --- | --- |
| Wire types (compile time) | generated from the spec | autocomplete, path/DTO completeness, visibility when Riot renames something |
| Wire validation (runtime) | hand-written TypeBox for the fields we store | trust boundary: reject a payload missing something we persist |
| Domain types | our code | what the DB and routes use — never a generated Riot DTO |

Rules that keep this from becoming a second `data-specification`:

- **Pinned, not latest.** `scripts/riot-spec.lock.json` holds the spec URL, sha256 and fetch date;
  the generator refuses a changed hash. Updating the contract is a deliberate commit.
- **Endpoint allowlist.** The spec covers every Riot game and ~100 paths; measured on 2026-11-21 it
  is ~500 KB and generates ~13k lines / 400 KB of `.d.ts`. The generator prunes to the paths we
  call (`account-v1`, `summoner-v4`, `league-v4`, `match-v5`); timeline and `tournament-v5` are one
  line each when a feature needs them. The file grows by decision, not by Riot adding Valorant.
- **Generated is generated.** `apps/api/src/riot/generated/riot-api.d.ts`, never hand-edited,
  excluded from Biome, regenerated with `bun run riot:types` (which can run `--check` in CI).
  Review is by spec hash + the paths we use, not by reading 13k lines.
- **No generated runtime schemas.** Runtime is a small TypeBox (`t`) set for only the fields §8
  stores, checked with `Value` from `@sinclair/typebox/value`: unknown fields pass, a *consumed*
  field that disappears fails. Validating a generated 650-field `MatchDto` on every game would be
  the opposite of that — and would fail on spec drift in fields we never read.
- **Types stop at `src/riot/`.** The client returns our shapes (§1); generated DTOs never leak into
  routes, the DB or the SPA.
- **Why not `openapi-zod-client`** (what Hex-Tractor uses): it emits zod 3 + zodios + axios. This
  repo has zod 4 transitively and TypeBox at the route boundary; types-only keeps runtime deps at
  zero and avoids a second validation library.

Fixtures make the narrow layer real without a key in CI: `scripts/record-riot-fixtures.ts` records
one response per call with our key, puuids/names are anonymised, and the files are committed under
`apps/api/test/fixtures/riot/`. Unit tests replay them; `bun run riot:contract` (manual, needs the
key) refetches and diffs. `bun run test` never needs network or a key.

Two boundaries worth writing down: the community repo is GPL-2.0 — pin by hash and commit generated
**types**, not its files, until the license is checked. And codegen does not create data Riot does
not expose: `match-v5` covers ranked games by `queueId`, `tournament-v5` covers API-created
tournaments, but external Liga/Prime League fixtures stay hand-entered in `matchdays`.

## 3. The three calls are one operation, three different failures

`resolveAccount` + `getSummoner` + `getRank` is the only useful unit for a profile check, but the
three can fail independently: the account can exist while summoner and rank are unavailable (wrong
platform is the classic case — step 1 succeeds on `europe`, then step 2 404s on `euw1`).

So the client offers **one composed call plus the pieces**:

```text
lookupAccount({ gameName, tagLine, platform })
  → { puuid, gameName, tagLine, summonerLevel?, profileIconId?, rank?, partial: boolean }
```

- `rank` is **optional by construction**: unranked is an empty array from step 3, and that is not an
  error — it is a player who does not play ranked.
- `partial: true` means step 1 succeeded and a later step failed. The UI shows the account with the
  fields it has; the row is stored unverified (§5).
- Composing in the client (and not the route) is what keeps "one HTTP request budget" countable (§4)
  and makes the fake trivial to configure per case.

## 4. The rate budget is the real constraint

A development key allows roughly **20 req/s but only 100 requests per 2 minutes**, and **expires every
24 hours**. The binding number is not 20/s, it is **~0.83 req/s sustained**, shared by everyone using
the key. Three calls per account means ~33 validations per two minutes for the whole server.

Requirements that follow — these are not polish:

- **Check on an explicit action, never per keystroke.** A "Check" button, or on blur of tag+region.
  Typing `Hide on bush` character by character is 12 validations.
- **Per-user throttle.** One person pressing Check in a loop must not spend the team's budget. A
  simple in-process limiter (per user, per minute) is enough for one API instance; it is a comfort
  feature, not a security boundary.
- **Cache the snapshot.** `fetchedAt` per account; show the cached card and refresh on demand. Never
  fetch on page render, and never fetch for every account of a roster to draw a table.
- **One composed lookup, not one call per field.** §3 exists partly so the cost of a check is a
  number we can count in tests.
- The dev key expiring daily is not a bug to work around — it is the normal state. See §5.

Re-verify the numbers in the portal before implementing; the dev tier is not a contract.

## 5. Degrade, never block

If the key is missing, expired, rate-limited or the host hangs, **saving the account still works**.
The row is written with `verifiedAt = null`, and the UI shows it as **unverified** (no level, no
rank, just the typed Riot ID). A key that dies every morning must not stop onboarding every morning.

The inverse is also true and easier to get wrong: **a lookup result is never trusted from the
client.** The SPA may show a checked card, but on save the server re-resolves and writes the snapshot
itself. Otherwise a client can claim any `puuid`, level or rank.

Two columns, two meanings:

| Column | Written | Means |
| --- | --- | --- |
| `verifiedAt` | only when steps 1–3 all succeeded | "this Riot ID resolved on this platform then" |
| `fetchedAt` | on every attempt that got data | "the snapshot below is from then" |

`verifiedAt = null` is a perfectly valid row. It is not an error state and must not be rendered as
one — "unverified" is a neutral badge, and the captain decides.

## 6. Error mapping — one status, one sentence

| Riot | Our error | What it usually means | UI |
| --- | --- | --- | --- |
| 404 | `not_found` | no such Riot ID **or the wrong region** | "Check name, tag and region" — name and region in one sentence, because they are indistinguishable |
| 400 | `bad_request` | malformed name/tag | inline field error, no toast |
| 429 | `rate_limited` | budget gone | "Try again in a moment"; honour `Retry-After` when present |
| 403 | `forbidden` | key invalid or expired | "Riot check unavailable" — **save is still allowed**, `verifiedAt = null` |
| timeout / network | `timeout` | nothing to say | same as 403, no retry loop in the request path |
| 5xx | `unavailable` | Riot is having a day | same as 403 |

`401`/`403` are *not* merged into one message, because "your key is wrong" is a server-operator
problem and "no such player" is a user problem; merging them sends people editing the wrong thing.

The mapping is a **pure function** (`toRiotError(status)` / `toRank(entries)`), unit-tested against
recorded payloads rather than a live key. This is also what finally gives `TIERS`, `DIVISIONS` and
`QUEUES` in `packages/shared` a consumer — see `quick-wins.md` A3.

## 7. The key is a server secret

`RIOT_API_KEY` in the environment, read by `env.ts` like `DATABASE_URL`, with two derived flags:

- `riotConfigured` — key present and non-empty. Same shape as `discordConfigured`, and the same
  consequence: a clear message instead of a cryptic failure when it is missing.
- `riotEnabled` — set to `false` to switch the integration off entirely without unsetting the key
  (useful for a prod instance that should not spend the budget).

The SPA never talks to Riot: it would leak the key and hit CORS anyway. So every Riot value the UI
shows has been through our API and our database — which is also why the snapshot is stored, not
fetched at render time.

The key goes into the same redaction the logger already applies to credentials: an `X-Riot-Token`
header must never appear in a request log line.

## 8. What the snapshot is allowed to contain

Only facts we cannot recompute: `puuid`, `summonerLevel`, `profileIconId`, `platform`, and the single
primary rank (`rankTier`, `rankDivision`, `rankQueue` from §3's `toRank`). Everything derivable —
label text, tier colour, "is unranked" — is computed at render time from those columns.

`profileIconId` (not a URL) for the same reason `hexserve-champion-data.md` stores ids: the icon URL
is Riot's CDN convention and changes independently of our data.

## 9. Testing — this module is where the fake pays off

The fake client is the whole reason `createApp({ riot })` exists. Cases to pin before code:

| Case | Assertion |
| --- | --- |
| happy path | three calls in the documented order, one composed result |
| `404` on step 1 | `not_found`; nothing written as verified |
| `404` on step 2 (step 1 fine) | `partial: true`, `puuid` kept, no level |
| unranked (empty array) | `rank` absent, not an error, `verifiedAt` still set |
| a queue we do not want | `toRank` picks solo queue, ignores the rest |
| `429` (with and without `Retry-After`) | `rate_limited`; the route still saves |
| `403` / timeout | `unavailable` / `timeout`; save still succeeds, `verifiedAt = null` |
| malformed body | `unavailable`, not a crash |
| no key configured | `riotEnabled`-style short-circuit, no fetch attempted |

Integration tests (throwaway database) cover the route contract: the guard, and "the server ignores a
client-supplied `puuid`/rank".

## 10. Decided: direct — this API calls Riot, Hex-Tractor is not a dependency

We hold our own Riot production key for this project, so the client talks to Riot directly. The
other project (Hex-Tractor, live at `hex-tractor.dump-collector.de`) was considered as a proxy and
rejected:

- **It is device-locked.** Production requires Apple App Attest or an Android Key Attestation
  certificate chain plus a per-request P-256 signature. Probed live on 2026-11-21:
  `POST /api/auth/devices/register` → `400 Invalid attestation data`, every protected route →
  `401 Missing authentication headers`. A server cannot register a device and there is no service
  credential; the dev bypass is `SERVER_ENV=development` only.
- **It solves a different problem.** Its harvesters feed Mongo from high-elo discovery and
  autocomplete, not "the games of these ten team members". Its endpoints return match data, but
  there is no tracked-roster contract to rely on.
- **It costs more than it saves.** Adopting it adds a second store (Mongo + Redis), a second DI and
  Zod contract, and a deploy coupling to a codebase we do not want to own.

The proxy shape is recorded here so it is not rediscovered: centralising the key and budget is only
worth it if the key had to be shared. Ours does not, so direct wins: one hop, Riot's statuses only,
the key in this API's env (§7).

## 11. Open questions

1. ~~**Direct or through our own proxy?**~~ **Resolved:** direct (§10).
2. **Which platform(s) do we offer?** A select with the EU platforms, or the full list? `euw1`
   default is settled; the length of the select is not.
3. **Do we refresh snapshots on a schedule, or only on demand?** On demand is enough for a profile
   card; `match-history.md` will want the `puuid` regardless and may make staleness visible.
4. **What is the shape of `rank` when a player is ranked in both solo and flex?** One primary queue
   stored (§8) — decide whether the column is a snapshot of solo queue or "the best of the two".
5. **Do we surface `wins`/`losses`?** They come free in the same payload and are cheap to store later;
   not needed for the profile card.
