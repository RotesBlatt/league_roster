# Idea — OP.GG meta data through the MCP endpoint

**Status:** idea, nothing implemented. Probed live 2026-11-24 (§2, §3): the meta side is real and
current, and match history answers on EUW for a normal account — but with region-dependent enums and
no `puuid`, so it is a scouting read, never the member sync (§3.1). No code exists and none is queued
behind this doc.
**Depends on:** `hexserve-champion-data.md` (champion ids and labels — we key op.gg rows by *our*
ids, never by their names) and, for anything player-facing, `team-home.md`, `champion-pools.md` or
`matchdays.md` as the consumer.
**Not the same thing as:** the op.gg **link builders** in `matchdays.md` §8.1. Those are string
concatenation and need no integration at all. This doc is about *data*, not URLs.
**Deliberately not** a source of truth for summoners or matches — §3.1 is why, and the official Riot
client is the better one anyway.

## 1. What the thing actually is

[`opgginc/opgg-mcp`](https://github.com/opgginc/opgg-mcp) is a 170-line MIT-licensed
**stdio→HTTP proxy**. It declares no tools, resources or prompts: it connects to the remote server,
bridges whatever capabilities it announces, and forwards. The product is the endpoint:

```text
https://mcp-api.op.gg/mcp        Streamable HTTP, JSON-RPC 2.0, no key, no account
```

Consequence, and it is the whole point of writing this down: **"using the MCP server" is not a thing
we install.** There is no package to add, no process to run, no `dist/index.js` to proxy through.
Either we call that URL from `apps/api`, or we don't use it.

And **an AI agent is not required**. MCP is a wire protocol, not a brain. Bun `fetch` is a valid
client. The 29 tools are ordinary functions with JSON-Schema inputs; the only thing an agent adds is
the ability to pick arguments for itself.

## 2. What the probe showed

`initialize` → 200, `serverInfo: "OP.GG MCP Server" 1.0.0`, capabilities `{tools, resources, prompts}`.
`tools/list` → 29 tools. Three real `tools/call`s:

| call | result |
| --- | --- |
| `lol_list_lane_meta_champions{position:mid, lang:de_DE}` | 51 mid champions, `Ahri 0.51 WR / 0.11 pick / 0.04 ban / tier 1 / rank 1` |
| `lol_get_champion_analysis{AHRI, mid, ranked}` | core items `Malignance → Shadowflame → Zhonya's` at 13% pick, Electrocute + Sorcery runes, play/win counts |
| `lol_get_summoner_profile{Hide on bush#KR1}` | level 946, Solo Master 381 LP — correct |

Latency 0.3–0.8 s; five back-to-back calls, all 200, **no throttling observed**. Server header is
Cloudflare. Every response carries a second `content` block: a tracker URL
(`…?utm_source=opgg_mcp&utm_medium=mcp&utm_campaign=…`) — their own usage attribution, free for them,
noise for us.

### The two things the probe also showed

1. **The payload is not JSON.** It is a Python-repr serialization with a hand-rolled class header:

   ```text
   class LolGetChampionAnalysis: champion,data,_field_diagnostics
   class Data: strong_counters,weak_counters
   class StrongCounter: champion_name,play,my_win_rate,counter_win_rate

   LolGetChampionAnalysis("KLED",Data([StrongCounter("Yorick",226,0.57,0.43),...],...))
   ```

   Fields are requested by a **closed-set string** (`data.positions.mid[].{champion,tier,win_rate}`),
   and a typo does not fail the call — it lands in `_field_diagnostics.unmatched_fields` and is
   silently dropped from the payload. A parser that ignores that block turns "I asked for the wrong
   field" into "the field is null", forever. (`lol_get_pro_player_riot_id` is the one tool that
   answers with real JSON — the serialization is per tool, not global.)
2. **The summoner tools are a scouting read, not a source.** §3.1 — and the enums inside them are
   region-dependent, which is the real reason not to build a sync on them.

## 3. The three draft-facing tools, validated one by one

The interesting use case is a **draft panel**: enemy first-pick → what in our pool beats it, what goes
well with what. That needs exactly three tools. All three answer — and the summoner one answers on
EUW after all, which corrects an earlier reading of this probe (§3.1).

### 3.1 `lol_list_summoner_matches` — works on EUW; the *enums* are what bite

First, the correction, because the first pass of this probe got it wrong: an EUW account that is
actually ours returns a full history. **`RotesBlatt#401` → 15 games, newest `2026-11-23T04:07`**
(probe date 2026-11-24), level 370, Flex Diamond III. Not empty, not stale, not regional.

| account | region | result |
| --- | --- | --- |
| **`RotesBlatt#401`** | EUW | **15 games, newest 2026-11-23** — live |
| `Pobelter#NA1` *(returned by the pro lookup for "Doublelift", see §3.4)* | NA | 10 games, newest 2026-11-24T12:20 — live |
| `Hide on bush#KR1` | KR | 20 games, newest 2026-10-17T01:53 |
| `허거덩#0303` (Chovy) | KR | 20 games, newest 2026-10-16T15:39 |
| `02170216#EUW` (Hans Sama), `KC Prime#6162` (Yike), `A 99 mid laner#EUW` (Caps) | EUW | `[]` — every spelling of the region code |
| `Thebausffs#EUW`, `Noway4u#EUW` | EUW | profile returned level 1 / 43, both unranked — placeholders |

The empty rows are **account-specific, not regional**: pro and smurf accounts whose op.gg page has no
games surface as `[]`, while a normal player's account is current. Probe date 2026-11-24.

What a game gives: `id`, `created_at`, `game_type`, `game_length_second`, the target summoner's
`champion_name`/`position`/`team_key`, `stats` (`kill/death/assist`, `op_score`, `op_score_rank`,
`result`, damage, wards) and both teams' `game_stat` + `banned_champions_names`. Five things to know
before writing a mapper, and four of them are traps:

- **`game_type` is region-dependent.** The same solo-queue game came back as `RANKED` on EUW and as
  `SOLORANKED` on KR and NA. Do not build a closed enum from one region's sample; normalise, and drop
  with a log line rather than guessing.
- **`team_key` is not always a side.** Ranked games give `BLUE`/`RED`; the ARENA game gave
  `PORO`/`RAPTOR` with `position: null`. Any view that assumes two sides must filter on `game_type`
  first.
- **`created_at` is `+09:00` even for an EUW account.** Convert to the team's clock; do not trust the
  offset. (Our availability planner already stores wall-clock minutes for this reason.)
- **`limit` is an upper bound, not a promise.** `limit: 20` returned 15 rows and that is not an error.
- **`participants` carries only the target summoner** ("excludes enemy stats" per its own
  description) — so no lane opponent, no team view. That needs `lol_get_summoner_game_detail` per
  game id.

Verdict: **`match-history.md` still stays on the official Riot API** for the member sync — we own
`puuid`, canonical labels, the 404 semantics and the throttling there, and a third hop is the wrong
foundation for a record of our own games. But the one thing in this payload Riot does *not* give is
**`op_score`** (plus `op_score_rank` and `op_score_timeline`), and that makes a *scouting* read
legitimate: `matchdays.md` wants "what has this enemy mid been playing, and how well" — one call, no
API key, no sync, no table. That is a small, honest use of the endpoint, and it is the one place this
tool earns its keep.

### 3.2 `lol_get_champion_analysis` — counters are exactly the "enemy picked X, so we pick Y" data

`weak_counters` = champions that beat your champion. That is the query, inverted: **for the enemy's
pick, read its `weak_counters`, keep the ones in our pool.** One call per enemy champion, no per-pair
work. `strong_counters` is the same table the other way round (your pick into their lane).

Measured, `ranked`, all tiers:

```text
AHRI mid   strong: Smolder 0.61 (161 games), Pantheon 0.60 (298), Malphite 0.59 (210)
           weak:   Annie   0.53 (2358),      Fizz     0.52 (2246), Mel 0.52 (1776)
KLED top   strong: Yorick  0.57 (226),       Sion     0.56 (287), Nasus 0.56 (169)
           weak:   Fiora   0.46→0.54 (354),  Kayle    0.47→0.53 (224), Singed 0.47→0.53 (221)
```

Semantics to get right, because they are easy to invert: `my_win_rate` is *the selected champion's*
win rate into that opponent; `counter_win_rate` is the opponent's. For a `weak_counter` row that means
`counter_win_rate` is the pick beating us.

Three properties that shape any UI built on it:

- **Sample sizes span two orders of magnitude** (161 vs 2358 plays) and only 3 rows per direction are
  returned. A draft helper that shows "0.61 vs Smolder" without the 161 must be showing a lie; put a
  floor on `play` in our own rules, not in the UI.
- **`counters_meta` is server-injected and must not be requested.** Asking for it in
  `desired_output_fields` yields `unmatched_fields` (verified). It arrives on its own when a counter
  list is empty for lack of sample — so an empty list needs no special-casing, but the *reason* is
  only there if we read the block.
- **A parser trap: `weak_counters` items serialize as class `StrongCounter`.** Same class name, both
  lists. A parser keyed on the class name cannot tell them apart; only the position in
  `Data(strong, weak)` can. This, plus the overall `_field_diagnostics` behaviour, is why the parser
  gets fixtures and a unit test (§7).

`champion_analysis` also carries `data.synergies.{adc,jungle,mid,support}` — **no `top`** (requesting
`data.synergies.top[]` yields `unmatched_fields`). Use §3.3 for the top lane.

### 3.3 `lol_get_champion_synergies` — works per pair, and `score` is always 0

Signature is `champion` + `my_position` + `synergy_position`: one ally lane at a time. So a full
draft answer is **up to 4 calls per champion you hold** (~0.5 s each), and it does cover `top`, which
§3.2 does not.

```text
Ahri mid → jungle   1 Lee Sin  tier 1  rank 1   3614 games  0.52
                    2 Vi        tier 2  rank 13  2707        0.50
Ornn top → jungle   1 Lee Sin  tier 1  rank 1    910        0.53
Jinx adc → support  1 Thresh   tier 1  rank 1   3824        0.51
                    2 Lulu     tier 1  rank 2   3663        0.49
```

Two facts worth knowing before designing anything on it:

- **`score` was `0` in every one of the 20 rows we fetched** across three calls. It is not a
  coincidence of one champion — treat it as unusable and rank by `score_rank` (or `play`, which is
  what `score_rank` appears to track). `synergy_tier_data.tier` is `0=OP, 1=S, 2=A, 3=B, 4=C`.
- **`win_rate` moves less than the noise**: 0.49 vs 0.53 across rows that differ 10× in sample size.
  The honest reading of "Lee Sin is our best jungle with Ornn" is `rank 1 of 10, tier 1, 910 games`,
  not "+3% win rate". Synergy is a weak signal; it is a *tiebreaker*, not an oracle.

### 3.4 Bonus finding: `lol_get_pro_player_riot_id` resolves the wrong player, silently

Alias lookup with `region` (required) returns the real Riot ID, team, and `aliases[]` — genuinely
useful for `matchdays.md` scouting ("who is this enemy mid?"). But it answers with **confidence it has
not earned**: `player_name:"Doublelift", region:"NA"` returned `Pobelter#NA1` / team FLY, and
`"Caps", "EUW"` returned a level-31 alt (`A 99 mid laner#EUW`) that the summoner tools then report as
unranked. No warning, no `suggestions` entry. Only safe use: display it as a *candidate* with the team
name next to it and let a human confirm. Everything it returns is real JSON, unlike the rest.

## 4. What it adds, and what it does not

### 4.1 Only the meta half is new

| We have | op.gg MCP has |
| --- | --- |
| **Riot API** — identity, ranks, match history, puuid (`riot-api.md`, shipped) | — for identity (§4.2) |
| **Hexserve dump** — champion id → label/icon per patch (`hexserve-champion-data.md`, shipped) | — |
| — | lane tier list: tier 1–5, win/pick/ban, rank + rank delta, `role_rate`, KDA |
| — | champion build: core items, boots, 4th/5th items, runes, skill order, spells, skill combos |
| — | **counter table** (§3.2) — the counter-pick answer |
| — | **synergy table** (§3.3) — the comp-fit answer, one lane pair per call |
| — | **`op_score`** per game (§3.1) — Riot's own API does not expose it, and it is the only reason to read games from here |
| — | ARAM augments, skin popularity, esports schedules + standings, pro-player Riot IDs |

So: **nothing here replaces what we have, and nearly everything here is data we cannot compute
ourselves.** For a draft panel the two tables that matter are the counter table and the tier list;
synergy is a tiebreaker (§3.3). The one overlap — game history — is settled in §3.1: Riot owns the
record, op.gg can supply a read-only scouting glance with scores we cannot get elsewhere.

### 4.2 Keep Riot for identity — one non-negotiable

`lol_get_summoner_profile` cannot resolve a Riot ID without `RIOT_API_KEY` and looks tempting as a
dev-environment shortcut. Do not: it returned placeholder rows for near-misses (§3.1), it has no
`puuid`, it answers `[]` for accounts with no public history, and it is a third party we would be
asking about our own members. The Riot client stays the only module that answers "who is this
account" — including for the *enemy* accounts that `matchdays.md` scouting wants, where a wrong
resolve is worse than no resolve.

## 5. The contract, if we ever build it

One module, `apps/api/src/opgg/`, shaped exactly like `riot/`: injected `fetch`, no URL and no
repr-parser leaking past its boundary. Routes get our shapes.

```text
apps/api/src/opgg/client.ts    session id, tools/call, the closed-set field strings
apps/api/src/opgg/parse.ts     pure: repr text → plain value + field diagnostics   ← unit tested
apps/api/src/opgg/meta.ts      the shapes a route gets: LaneMeta[], Counters, Synergies
```

Four rules that are the actual design:

1. **Cache per patch, never per request.** Meta is a per-patch fact like `champion_patch`. Store the
   parsed rows with the patch they belong to and refresh on patch change — not on a TTL, not on a
   page render. One pull per lane per patch is ~5 calls per 2 weeks; the counter table for the whole
   roster is ~1 call per champion per lane, so also per patch, also bored into a table.
2. **A failed refresh is not an outage.** The page renders the last known patch's rows with its
   patch label, exactly like the champion dump. op.gg has no SLA (§6).
3. **Pay the `client_app` field.** `"LolTeam/0.1"` on every call. They asked for it in the server's
   `instructions`; it is the cheapest possible good faith and it costs one string.
4. **Refuse unknown ids.** Our champion ids come from the dump; an op.gg name we cannot map is
   dropped with a log line, never rendered as a label. (The reverse of the `ChampionIcon` placeholder
   rule — there we *have* an id and no label, here we have a label and no id.)

## 6. The risks, stated plainly

- **No SLA, no published rate limits, no versioning, no auth.** It is a courtesy endpoint. Terms
  allow data use with attribution and without commercial use or load that hurts availability
  (`help.op.gg` data-usage article). A team-internal app with a per-patch cache is comfortably inside
  that; a "meta" feature with a refresh button would not be.
- **Region coverage is uneven and undocumented** (§3.1): `game_type` and `team_key` differ by region
  and queue, and an account with no public history answers `[]` — indistinguishable from "no games".
- **The format can change silently** — a repr tweak breaks `parse.ts`. The unit test in §7 is the
  alarm, not a `try/catch` that returns `[]`.
- **Their data is derived from Riot's, at their aggregation.** We are a third hop from the source.
  That is fine for "what's strong this patch"; it is not fine for anything a member's record depends
  on.
- **It is a feature we cannot run offline**, unlike the hexserve dump, which we re-host. Accept it or
  don't build the feature.

## 7. Testing

- `apps/api/test/unit`: the repr parser against **checked-in fixture strings** — one
  `lol_list_lane_meta_champions`, one `lol_get_champion_analysis` with `strong_counters` *and*
  `weak_counters` (the same-class trap in §3.2), one `_field_diagnostics` case, one nested-array case.
  This is the only genuinely tricky code here, and it is pure.
- `apps/api/test/unit`: the field-string builder (ids → `data.positions.mid[].{champion,tier,...}`),
  "unmatched fields ⇒ loud failure, not a silent empty", and the draft rules below.
- **Business rules live in plain functions and get unit tests**, per `AGENTS.md`:
  `counterPicksFor(enemyChampion, pool, {minPlay})` and `synergyScore(candidates, {minPlay})` — the
  `minPlay` floor and the pool intersection are decisions, not plumbing.
- Nothing integration: the endpoint is not ours to test against. The refresh path gets a fake
  `fetch`, like the Riot client does.

## 8. Open questions

1. **Do we want `op_score` badly enough to add a third hop?** §3.1 says the scouting read works and
   Riot cannot give us that number. But it is still an extra upstream on the one path (`matchdays`
   scouting) that already has a cheaper answer: a link to the enemy's op.gg page. Decide before
   building it; "we can" is not the same as "we should".
2. **Which consumer first?** `team-home` ("what is strong right now"), `champion-pools` ("this blind
   pick is tier 4") and the [drafter](../matches/drafter.md) (a hint list per pick) all want a slice.
   The drafter is the only one that *cannot* be built without this module, so it is now the named
   first consumer. Building the module before any consumer still needs a reason — a doc naming a
   consumer is not the same as that consumer existing.
3. **Tier list or counters?** The tier list is 5 calls per patch and one flat shape. Counters are
   1 call per champion per lane and the interesting one for a draft. If only one ever ships, it is
   the tier list (cheap) unless the draft panel exists (then counters).
4. **Does a draft panel belong in this app at all?** `matchdays.md` treats a matchday as a record
   (opponent, W/L, VOD, scouting note). A live "enemy picked X → pick Y" panel is a *different*
   product — real-time, per-game, and it competes with the tools players already have open. That is
   a user decision, not an implementation detail.
5. **Do we even want a meta opinion in a team app?** A tier list invites "pick what's OP" over "pick
   what you play". `champion-pools.md` §2 argues the pool is a human decision; a meta column must not
   quietly turn it into a ranking.
6. **Attribution.** If a page shows this, it shows "via OP.GG" with a link. Decided in whatever patch
   renders it, not here.
