# Quick wins — findings from the module walkthrough

**Status:** findings only, nothing fixed. Ordered by risk, cheapest first.
Rule for every item: per `AGENTS.md`, a behaviour change ships with a test that failed first.
Pure deletions need no new test — but do run the suite.

## A. Dead weight — delete, zero behaviour change

| # | Finding | Where | Why it matters |
| --- | --- | --- | --- |
| A1 | **`invite_code_idx` is a duplicate index.** `code` already has `CONSTRAINT invite_code_unique UNIQUE("code")`, which *is* a btree index. The extra plain index on the same column costs writes and buys no reads. | `db/schema.ts:113` → drop the line, `db:generate` | One fewer index to maintain forever |
| A2 | **`docker/backup.sh;C` is a stray empty directory** (Windows artifact, untracked, not in git). | `docker/` | Deletes the "wait, is that a DOS 8.3 name?" moment |
| A3 | **Four unused exports in `packages/shared`:** `canManageTeam`, `QUEUES`, `TIERS`, `DIVISIONS`. `canManageTeam` is used *only by its own test* — tested dead code, the worst kind, because it looks maintained. `QUEUES` appears nowhere at all. `TIERS`/`DIVISIONS` are for a rank feature that does not exist. | `packages/shared/src/index.ts:18,21,35,39` + `test/index.test.ts` | Removes a false signal: the shared package currently promises four features it doesn't back |

A3 is the interesting one. It isn't just tidiness — `canManageTeam` encodes "captain + active" as a
*shared* rule while the API actually enforces it in `plugins/auth.ts`. Two sources of truth for the
same policy, one of them unused. Either delete it, or make the API use it (harder: the API guard
needs DB reads, the helper takes a plain object). Deleting is honest until something needs it.

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
| B1 | **`DELETE /api/players/:id` returns `{ ok: true }` even when nothing matched**, while `PATCH` and `invites/:id/revoke` correctly 404. Pick one. `revoke` is the better precedent. | `routes/players.ts:96-103` |
| B2 | **The TOP→SUP order is written twice.** `ROLES` in shared is *already* in domain order; `players.ts` repeats it as a SQL `CASE`. If someone reorders `ROLES`, the UI dropdown and the roster sort disagree silently. | `routes/players.ts:38-40` vs `packages/shared/src/index.ts:1` |

B2 has a real trap: the duplication only breaks when `ROLES` changes, which is exactly when nobody
re-reads the SQL. A generated CASE from `ROLES`, or a `position` column, kills it.

## C. Testability debt — small extraction, then a unit test

| # | Finding | Where |
| --- | --- | --- |
| C1 | **Two business rules live inside the members PATCH handler**: "you cannot disable your own account" and "there has to be at least one active captain". Both correct, both tested — but only through HTTP, per `AGENTS.md`'s own rule ("a route handler that thinks is a route handler that can't be tested"). | `routes/members.ts:52-66` |

Extract to `decideMemberChange(db, {actor, target, body})` → `{ ok } | { ok: false, status, message }`,
mirroring `claimInvite`'s shape (which is the established pattern in this codebase). The
`multi-team.md` change rewrites this handler anyway — do it first, while it's small.

## D. Correctness hardening — needs a decision, not just an edit

| # | Finding | Where |
| --- | --- | --- |
| D1 | **Enums are TypeScript-only, the DB won't object.** `role`/`status`/position are plain `text` columns with no `CHECK` (`0000_tough_sauron.sql:63-64`). Nothing at the DB layer rejects `'captain '` or a typo'd status. Only the TS union + Elysia validation stand in the way — and raw SQL/migrations bypass both. | `db/schema.ts:23-24`, `:85` |
| D2 | **The bootstrap promotion is a read-then-write race.** Two first logins at the same instant on an empty install can both see `count(active) === 0` and both become captain. | `lib/access.ts:55-58` |

D1: a `CHECK` constraint is cheap and makes the DB a real backstop. Cost: a migration + keeping the
shared enum and the SQL list in sync (or generating the CHECK from `ROLES`). D2: `multi-team.md`
deletes this branch entirely — so do **not** fix it separately, it's about to disappear.

## E. Performance — only if it actually bites

| # | Finding | Note |
| --- | --- | --- |
| E1 | ~~No index on `user.status`, `ensureAccess` runs `count(*) where status='active'` per request.~~ **Gone**: the query died with the bootstrap (`multi-team.md` §11.6). | Nothing to do. |
| E2 | **~2 queries per authenticated request**: `session ⋈ user` (getSession), `select from user` (getMe). | The third one (`select from account`, the allowlist) is gone — §11.6. Collapsing `getMe` into the session lookup is possible but couples you to better-auth's join. Measure first. |
| E3 | **No `session.cookieCache`**, so `getSession` always hits the DB. | Deliberate: the cache trades instant revocation for the query. Don't "optimise" this without deciding that tradeoff explicitly. |
| E4 | **`player_role_idx` is probably unused** — nothing filters on `player.role` by equality, and `ORDER BY CASE role …` doesn't use it. | `EXPLAIN` before dropping. Low value either way. |

## F. Not quick wins (don't start these thinking otherwise)

- **`env` is a module-level singleton** (`env.ts:93`) — tests live with the defaults. Injecting an
  `Env` into `createApp` is the cleaner design, but it touches every file that imports `env`.
- **`RequireMember` is UX, not security.** Correct as-is; the point is to keep it that way. Anyone
  "simplifying" the API guards because "the UI already checks" is the failure mode.
- **`data/team.db`** is a local artifact — already gitignored (`data/*.db`). Leave it, or delete it
  locally; nothing to fix.

## Suggested order

1. **A1, A2, A3** — deletions, no tests needed, one commit each (`chore: drop duplicate invite index`,
   `chore: remove unused shared exports`).
2. **C1** — before any multi-team work touches `members.ts`.
3. **B1, B2** — small, each with a failing test first.
4. **D1** — decide whether the DB should enforce enums; then one migration.
5. **E\*** — measure, don't guess.
