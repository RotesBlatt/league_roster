# Idea — the Riot API is one injected client, not a fetch in a route

**Status:** idea, nothing implemented.
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

Verify the routing values and payload shapes against the live reference before implementing. Riot has
removed fields before (the legacy `summonerId`/`accountId` are already gone from payloads), and a
payload field that no longer exists is a `null` in the UI, not an error.

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

## 10. Open: is the key called from here, or from our own proxy?

There is a second project in play that already runs a server component. Two shapes, and it is a
decision for the user, not for this doc:

| | Direct: this API calls Riot | Proxy: this API calls our other server |
| --- | --- | --- |
| Key lives in | this API's env | one place, in the other project |
| Rate budget | shared across whatever else uses the key — and we would not see the others | centralised, can cache across consumers |
| Failure modes | Riot's statuses only | Riot's statuses **plus** a second thing being down |
| Contract | Riot's | ours to define, ours to keep in sync |
| Latency | one hop | two hops |

The client interface is deliberately the same either way: the proxy case swaps
`createRiotClient({ fetch })`'s base URL, nothing else. So this can be postponed without postponing
the work — but it should be decided before the first real key is wired in, because it decides where
the secret and the budget live.

## 11. Open questions

1. **Direct or through our own proxy?** §10 — the user's call.
2. **Which platform(s) do we offer?** A select with the EU platforms, or the full list? `euw1`
   default is settled; the length of the select is not.
3. **Do we refresh snapshots on a schedule, or only on demand?** On demand is enough for a profile
   card; `match-history.md` will want the `puuid` regardless and may make staleness visible.
4. **What is the shape of `rank` when a player is ranked in both solo and flex?** One primary queue
   stored (§8) — decide whether the column is a snapshot of solo queue or "the best of the two".
5. **Do we surface `wins`/`losses`?** They come free in the same payload and are cheap to store later;
   not needed for the profile card.
