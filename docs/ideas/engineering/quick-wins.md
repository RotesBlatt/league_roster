# Quick wins — findings from the module walkthrough

**Status:** findings only; the walkthrough is from before `multi-team`, `player-profiles`,
`riot-api`, `availability-planner` and `hexserve`. **A1, A3, C1 and C2 landed 2026-11-26; the rest
were re-verified against the tree that day and six of them no longer exist (marked below).**
Ordered by risk, cheapest first.
Rule for every item: per `AGENTS.md`, a behaviour change ships with a test that failed first.
Pure deletions need no new test — but do run the suite.

## A. Dead weight — delete, zero behaviour change

| # | Finding | Where | Why it matters |
| --- | --- | --- | --- |
| A1 | ~~**`invite_code_idx` is a duplicate index.**~~ **Done 2026-11-26**: the third `pgTable` argument is gone from `db/schema.ts` and `0014_burly_pandemic.sql` drops the index; `code` keeps its `UNIQUE`, which is the btree that serves the same lookups. | `db/schema.ts` → `0014` | One fewer index to maintain forever |
| A2 | ~~**`docker/backup.sh;C` is a stray empty directory**~~ **Gone**: `docker/` holds `backup.sh` and `entrypoint.sh`, nothing else. | `docker/` | — |
| A3 | ~~**Four unused exports in `packages/shared`:**~~ **Split, then done.** `TIERS`/`DIVISIONS`/`QUEUES` were kept and are now used by `riot.ts` + `mappers.ts` (see the note below). `canManageTeam` was deleted on 2026-11-26 along with its test block — no import survived it. | `packages/shared/src/team.ts` | Removes a false signal: a helper the shared package promised and nobody called |

A3 is the interesting one. It isn't just tidiness — `canManageTeam` encoded "captain + active" as a
*shared* rule while the API actually enforces it in `plugins/auth.ts`. Two sources of truth for the
same policy, one of them unused. Either delete it, or make the API use it (harder: the API guard
needs DB reads, the helper takes a plain object). Deleting was the honest answer: the guard is the
enforcement point, and a second copy of the policy is a liability, not a convenience.

**Caveat (added after `player-profiles.md` §4):** the Riot-API idea revives `TIERS`, `DIVISIONS` and
`QUEUES` for rank display. So split the decision: delete `canManageTeam` (genuinely dead), but keep
the rank vocabulary — or delete it too and re-add it with the feature. Don't delete it and then be
surprised when the Riot work needs it back.

**Resolved 2026-11-21:** `riot-api` landed and consumes all three — `isTier`/`isDivision`/`isQueue`
guard payloads, and `QUEUES` orders the two rank badges. `canManageTeam` is still dead and still the
only deletion here.

## B. Small inconsistencies — one line each, needs a test

| # | Finding | Where |
| --- | --- | --- |
| B1 | ~~**`DELETE /api/players/:id` returns `{ ok: true }` even when nothing matched**~~ **Already fixed elsewhere**: `DELETE /api/teams/:slug/roster/:id` returns rows from the delete and 404s on none (`routes/roster.ts`), so the `revoke` precedent won. | `routes/roster.ts` |
| B2 | ~~**The TOP→SUP order is written twice.**~~ **Already fixed elsewhere**: the SQL `CASE` died with the `player` table. `composeRoster` sorts by `ROLES.indexOf(...)` from shared, so the dropdown and the roster read the same array. | `lib/roster.ts` vs `packages/shared/src/team.ts` |

B2's trap is gone with the duplication, but the shape to prefer is still the one that landed: **derive
the order from `ROLES`, never restate it.** If a future query needs SQL ordering, generate the CASE
from the array rather than typing the roles out.

## C. Testability debt — small extraction, then a unit test

| # | Finding | Where |
| --- | --- | --- |
| C1 | ~~**Two business rules live inside the members PATCH handler**~~ **Done 2026-11-26**: `decideMemberChange` in `lib/member-change.ts` decides both rules from `{ actorId, target, body, activeCaptainCount }`, and the route only supplies the facts. Eleven unit tests, no database. The shape it settled on is *purer* than `claimInvite`: the count is passed in rather than queried, because a rule that queries cannot be tested without Postgres. | `lib/member-change.ts` |
| C2 | ~~**The last-captain rule is one row too strict.**~~ **Done 2026-11-26**: `spendsACaptain` now requires `target.status === 'active'` as well, so demoting a captain who is already disabled is no longer mistaken for a spent captaincy. The count only ever covered *active* captains, which is what made the old predicate wrong: the target was never in the number it was compared against. Found while extracting C1; kept out of that patch because fixing it is a behaviour change, not an extraction. | `lib/member-change.ts` (`spendsACaptain`) |

C1's shape is the one to copy for future rules: pass the facts, return a decision. `claimInvite` takes a
`Db` because claiming genuinely is one transaction; a *decision* should not be.

## D. Correctness hardening — needs a decision, not just an edit

| # | Finding | Where |
| --- | --- | --- |
| D1 | **Enums are TypeScript-only, the DB won't object.** `membership.role`/`status`, `profile.preferredRole` and the `riot_account` tier/division/queue columns are plain `text` with no `CHECK`. Nothing at the DB layer rejects `'captain '` or a typo'd status — only the TS union + Elysia validation, which raw SQL and migrations bypass. | `db/schema.ts` (`memberships`, `profile`, `riotAccounts`) |
| D2 | ~~**The bootstrap promotion is a read-then-write race.**~~ **Gone**: the branch died with `multi-team` (§11.6); there is no `count(active) === 0` left to race on. | — |

**D1 decided 2026-11-26: yes, the DB becomes a backstop, and the `CHECK` is generated from the
shared enum rather than typed out.** A hand-written SQL list is the same duplication trap as B2 — it
only drifts when nobody is reading, which is exactly when it matters. The migration is a
`CHECK (col IN (…))` per column, built from `ROLES`/`MEMBER_STATUSES`/`USER_ROLES`/`TIERS`/
`DIVISIONS`/`QUEUES`, so adding a role is one edit in `packages/shared` plus `db:generate`.

## E. Performance — only if it actually bites

| # | Finding | Note |
| --- | --- | --- |
| E1 | ~~No index on `user.status`, `ensureAccess` runs `count(*) where status='active'` per request.~~ **Gone**: the query died with the bootstrap (`multi-team.md` §11.6). | Nothing to do. |
| E2 | **~2 queries per authenticated request**: `session ⋈ user` (getSession), `select from user` (getMe). | The third one (`select from account`, the allowlist) is gone — §11.6. Collapsing `getMe` into the session lookup is possible but couples you to better-auth's join. Measure first. |
| E3 | **No `session.cookieCache`**, so `getSession` always hits the DB. | Deliberate: the cache trades instant revocation for the query. Don't "optimise" this without deciding that tradeoff explicitly. |
| E4 | ~~**`player_role_idx` is probably unused**~~ **Gone**: the `player` table was dropped in `0007`. | Nothing to do. |

## F. Not quick wins (don't start these thinking otherwise)

- **`env` is a module-level singleton** (`env.ts:93`) — tests live with the defaults. Injecting an
  `Env` into `createApp` is the cleaner design, but it touches every file that imports `env`.
- **`RequireMember` is UX, not security.** Correct as-is; the point is to keep it that way. Anyone
  "simplifying" the API guards because "the UI already checks" is the failure mode.
- **`data/team.db`** is a local artifact — already gitignored (`data/*.db`). Leave it, or delete it
  locally; nothing to fix.

## Suggested order

1. ~~A1, A2, A3, C1, C2~~ — landed 2026-11-26.
2. **D1** — next: decided (generated `CHECK`s); one migration, tested by the replay harness, with the
   `SEED_OVERRIDES` map extended if a `CHECK` spans columns.
3. **E\*** — measure, don't guess.

## Where this stopped — 2026-11-26 (handoff)

**Committed, tree clean.** Six patches, each green on `bun run test` + `bun run test:db` +
`bun run typecheck` at the time it landed:

| Commit | What it did | Item |
| --- | --- | --- |
| `37f8144` | `chore(shared): drop dead canManageTeam helper` | A3 |
| `eabdf89` | `chore(api): drop duplicate invite code index` (`0014_burly_pandemic.sql`) | A1 |
| `22d120b` | `refactor(api): move member rules into decideMemberChange` | C1 |
| `3771478` | `docs(ideas): update quick-wins after A1/A3/C1` | — |
| `fe30a3c` | `feat(web): refetch queries when the window regains focus` | `realtime.md` Tier 0 |
| `5e42135` | `fix(api): allow demoting a disabled captain` | C2 |

**Pick up here, in this order:**

1. **D1 — `CHECK`s generated from the shared enums.** Shape decided above. Note the two costs the
   decision implies: `db:generate` will emit one `ALTER TABLE … ADD CONSTRAINT` per column (a
   migration the replay harness covers automatically, no allowlist entry — `migrations-safety` only
   guards columns and tables), and the row seeder writes `'seed'` into every text column, so any
   `CHECK` on a column the seeder touches must either accept that literal or land in
   `SEED_OVERRIDES` (`test/integration/migrations.test.ts`). That map is the tripwire, not a
   gotcha — its own test fails the day a new `CHECK` needs an entry.
2. **`realtime.md` Tier 0, the rest of it** — `online`/`visibilitychange` refetch is the next
   cheapest slice, then optimistic writes for the laggy mutations, then the 15 s poll on the matchday
   page (which does not exist yet, so it waits for `matchdays`).

**Known-stale doc rows elsewhere** (found while walking the tree, not fixed because they are other
ideas' docs): `web-architecture.md` still lists `RosterPage`/`AdminPage` as they were before
`player-profiles` split the roster; `team-home.md` depends on four ideas that have since landed and
has not been re-read against them.
