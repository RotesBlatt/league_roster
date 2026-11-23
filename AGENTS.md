# Agent notes

## TDD — test first, then make it pass

We work test-driven, not test-after. The order is the point:

1. Write the failing test that describes the behaviour you want.
2. Run it. **Watch it fail for the right reason** (paste the failure).
3. Write the smallest change that makes it pass.
4. Run the whole suite; refactor only under green.

A test that was written after the code never proved it could fail. If you
couldn't start test-first (bug discovered mid-flight), say so explicitly and
show the test failing against the old behaviour before the fix lands.

## Testing policy — non-negotiable

Every code change ships with tests. "It's a small change" is not an exemption.

- Run `bun run test` (unit) and `bun run test:db` (integration, needs
  `docker compose up -d db`) before saying anything is done.
- **Tests never live in `src/`.** Every workspace has `test/` next to `src/`:
  `apps/api/test/unit/`, `apps/api/test/integration/`,
  `apps/web/test/`, `packages/shared/test/`. `src/` stays shippable code only.
- Unit tests must not need infrastructure. Anything touching Postgres goes in
  `integration/` and uses the throwaway-database harness
  (`apps/api/test/integration/helpers.ts`).
- New route → test its guard (401 / 403 / allowed) **and** its happy path.
- New business rule → extract the rule into a plain function and unit test it.
  A route handler that "thinks" is a route handler that can't be tested.
- Bug fix → regression test that fails without the fix. No exceptions.
- **A migration is tested against rows, not an empty schema.** It ships with a
  test that applies the previous schema, seeds it, then migrates; the SQL must
  not add `NOT NULL` without a `DEFAULT`/backfill or drop data without an
  allowlisted reason (`apps/api/test/unit/migrations-safety.test.ts` and
  `apps/api/test/integration/migrations.test.ts`).
- **A deploy dumps before it migrates.** `docker-compose.yml`'s `pre-migrate`
  service gates `app`; never remove that dependency.
- UI: keep logic in plain modules (`api-result.ts`, `badges.tsx` mappings) and
  unit test those; don't reach for a DOM harness unless behaviour needs it.
- Never leave `bun run test`, `bun run test:db`, `bun run typecheck` or
  `bun run check` red at the end of a turn.

## Pair programming — how work happens here

Go slow. Ask. Work *with* me, not ahead of me.

1. State the plan first: files touched, order, what changes, how it is verified.
2. Wait for a go-ahead before multi-file or architectural work.
3. **One thing at a time in the working tree. Never two.** Not "the fix plus its
   tests plus the web side", not "the feature plus a tidy-up". If a step needs
   more than one package, it becomes several patches applied one after another;
   the next one does not exist in the tree until I have reviewed and committed
   the previous one. A working tree containing two ideas is unreviewable and is
   not a shortcut — it is the thing that made me stop working with you.
4. **One package at a time.** `packages/shared` → `apps/api` → `apps/web`. A
   cross-package change is a *sequence*, never one diff.
5. Small steps, one topic per step. Don't bundle an unrelated refactor into a fix
   — and don't bundle formatting either (see below).
6. Raise decisions that belong to the user (stack choice, data model, deploy
   target, product rules) instead of silently picking one.
7. Commit only when explicitly asked. I say "committed" — then, and only then,
   the next patch.

### The review rhythm

The loop is: you write **one** patch → I read `git diff` → I say "committed" →
you write the next one.

- Apply one patch to the working tree, then **stop**. Do not start the next one,
  do not "also fix" something you noticed, do not regenerate the queue silently.
- Tell me exactly four things: **what changed** (file → the change), **what to
  check**, **what is expected to be red until a later patch**, and a **recommended
  commit message** — one line, ready to paste, obeying the commit rules below. It
  is a recommendation to accept or rewrite, never a commit: I still commit.
- Keep each patch reviewable in one screen (~1 file, ~100 lines). If it can't be,
  it is too big — split it by concern *before* applying it.
- Formatting is never part of a behaviour patch. `bun run check` reformats whole
  files; if it touches files you did not intend to change, revert that and make a
  separate `style:` commit.
- Never commit on my behalf, and never rewrite history I already committed.
- If a patch turns out wrong, say so and propose the fix as its own patch.

### Commit size

Small commits that each make sense on their own — not one commit with 100 file
changes. A commit is one idea:

- a refactor that changes no behaviour, or
- a failing-test + the fix that makes it pass, or
- a test-only addition for behaviour that already landed (state that in the body).

Rules that keep history usable:

- One idea per commit. If the subject line needs "and", split it.
- Tests travel with the change they cover; a bugfix commit contains its
  regression test.
- Every commit compiles and keeps the suite green (`bun run typecheck`).
- Touching more than ~10 files is a signal to split by concern.
- **One line per commit message. No body.** Subject ≤50 chars, imperative,
  scoped (`fix(api): …`). If the why does not fit on one line, the commit is
  too big — split it, or put the reasoning in the code it belongs to.
- Every patch report carries that message already written out, so the loop never
  stalls on "what do we call this commit?". If I have to edit the proposal, the
  patch was doing more than its one idea.

## Stack

Bun workspace: `apps/api` (Elysia + better-auth + Drizzle/Postgres),
`apps/web` (Vite + React + Mantine + Eden Treaty), `packages/shared`.

Dependencies are injected, not imported as singletons, in the API:
`createApp({ db, auth })`, route factories take `Db`. Keep it that way — it is
what makes the tests possible.

## Ideas

`docs/ideas.md` is the register: one-line summaries, each linking to its doc in
`docs/ideas/`. A new idea gets a doc **and** a row in the register, in the same
commit. Read the register before proposing a feature — the doc already records
what was decided and what is still open.

## Bugs

`docs/bugs.md` is the bug queue: one row per known bug plus a section with
repro / actual / expected, observations kept separate from suspected causes.
**Record only when asked** — not every bug noticed belongs here. **Record in one
patch, fix in the next**: the fix patch writes the failing regression test first
and then **deletes the entry**, because the test is the durable record. The file
is permanent and stays when the table is empty; ids (`B1`, `B2`, …) are never
reused.

## Commands

| command                              | meaning                                                  |
| ------------------------------------ | -------------------------------------------------------- |
| `bun run dev`                        | API :3001 + Vite :5173                                   |
| `bun run test`                       | unit tests (no infra)                                    |
| `bun run test:db`                    | integration tests, creates and drops throwaway databases |
| `bun run typecheck`                  | tsc, all workspaces                                      |
| `bun run check`                      | Biome lint + format (write)                              |
| `bun run db:generate` / `db:migrate` | Drizzle migrations                                       |
