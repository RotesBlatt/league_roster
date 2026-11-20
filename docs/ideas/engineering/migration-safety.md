# Idea — a migration can never take prod down again

**Status:** idea, nothing implemented. Written up from a real incident (2026-11-21); the failing
migrations are still unfixed in the tree.
**Scope:** `apps/api/drizzle`, `apps/api/test/integration`, `apps/api/test/unit`, `docker/entrypoint.sh`,
`.github/workflows/ci.yml`, `AGENTS.md`.

## 1. The incident

Deploying to the VPS, the container died in its entrypoint:

```text
[entrypoint] applying migrations
ALTER TABLE "invite" ADD COLUMN "teamId" text NOT NULL;
PostgresError: column "teamId" of relation "invite" contains null values   (code 23502)
```

- **Cause:** `drizzle/0001_flippant_scorpion.sql:21` (and `:22` for `player`) adds a `NOT NULL`
  column with no default and **no backfill**. Correct on an empty database, impossible on a database
  that already has `invite`/`player` rows — i.e. exactly prod.
- **Blast radius:** `docker/entrypoint.sh` is `set -eu` and runs `migrate.ts` *before* the API, so a
  failed migration is a dead service, not a degraded one.
- **Saving grace:** drizzle runs all pending migrations in a single transaction
  (`pg-core/dialect.js:60`), so 0001 rolled back completely. Prod is still at `0000` and untouched.
  The first action on any such failure is therefore a dump, before anything is "fixed":
  `docker compose exec -T db pg_dump -U lol -d lol > lol-team-$(date +%F).sql`.
- **Also unfixed:** `0002_needy_puma.sql` does `ALTER TABLE "membership" ADD COLUMN "updatedAt" …
  NOT NULL` — the same shape, and it fails as soon as `membership` has one row. Any backfill in 0001
  that inserts memberships walks straight into it. 0001 + 0002 must be fixed together.

### Why every check stayed green

All four of our migration paths start from an **empty** database, so none can produce the error:

| Path | What it migrates |
| --- | --- |
| `test/integration/helpers.ts:38` (`createTestContext`) | fresh throwaway DB, `migrate()` on nothing |
| CI `integration` job, `bun run db:migrate` | empty Postgres service |
| CI `package` job, image smoke test | empty Postgres service — "migrations applied" only proves the file parses |
| local `docker compose up` | fresh volume |

This is not a one-off bug; it is a **missing test dimension**. A migration is the only code we ship
that runs against *state* we do not own, and it is the only code we never exercised against state.

## 2. The rule to adopt

> **A migration is done only when it has been applied to a database seeded with the previous
> schema.** "It migrates a fresh DB" is not evidence — a fresh DB is the one case prod never is.

Two corollaries:

- **Backups precede migrations, always.** The entrypoint dumps before it migrates, and refuses to
  migrate if the dump fails.
- **Destructive statements are a decision, not a line of SQL.** `DROP COLUMN` / `DROP TABLE` /
  `SET NOT NULL` need a backfill or an explicit allowlist entry with a reason.

## 3. The patches, in order (each one idea, each green)

### P1 — test the migration chain against data (test first)

`integration/helpers.ts` gains `migrateTo(db, index)`: `readMigrationFiles({ migrationsFolder })` from
`drizzle-orm/migrator`, then `db.dialect.migrate(files.slice(0, index), db.session, config)` — the
migrator already takes the array, so no copy of the folder is needed.

New `apps/api/test/integration/migrations.test.ts`: migrate through `0000`, seed a prod-shaped install
(a `user` with the old `role`/`status`, one `invite`, one `player`), then run the full `migrate()`.
**Expected red today: `23502 … contains null values`** — the incident reproduced as a test. That
failure is the proof the test can catch the class; it goes green with P2.

### P2 — the backfill (blocked on §5)

`0001`: create the legacy team, add `teamId` **nullable** to `invite`/`player`, `UPDATE … SET
"teamId" = '<legacy>'`, then `SET NOT NULL`; insert one `membership` per existing user from the old
`user.role`/`user.status` **before** 0001 drops those columns.
`0002`: `ADD COLUMN "updatedAt" … NOT NULL DEFAULT now()` then `DROP DEFAULT`.

Editing shipped migrations is safe *for this case*: the migrator orders by `_journal.json`'s `when`,
not by hash, so DBs that already ran 0001 do not re-run it — only prod (stuck at 0000) applies the
fixed version.

### P3 — ban the shape, not the instance

`test/unit/migrations-safety.test.ts`, plain file parsing over `apps/api/drizzle/*.sql`, red on:

- `ADD COLUMN … NOT NULL` without `DEFAULT`
- `ALTER COLUMN … SET NOT NULL` with no preceding `UPDATE` in the same file
- `DROP COLUMN` / `DROP TABLE` not listed in an allowlist (file → statement → reason)

Milliseconds, no infrastructure, runs in `bun run test`, so nobody has to remember the rule.

### P4 — prod cannot migrate without a backup, and cannot migrate twice

`docker/entrypoint.sh`:

1. `pg_dump` to the existing `pg-backups` volume (compose already mounts it on the `backup` service);
   abort if the dump fails.
2. `SELECT pg_advisory_lock(...)` around the migrate step so two replicas cannot race.

A migration may then fail loudly with yesterday's data safe on disk.

### P5 — CI proves the artifact against a legacy DB

In `.github/workflows/ci.yml`'s `package` job, seed the Postgres service with a pre-0001 fixture
(`0000`-era schema + a few rows) **before** starting the image, and keep
`docker logs lol-team | grep -q "migrations applied"`. This closes the gap between "the image is
fine" and "the image is fine against a database shaped like prod".

### P6 — the policy line in `AGENTS.md`

One sentence under *Testing policy*: a migration ships with a test that applies it to a DB seeded
with the previous schema; a deploy dumps before it migrates.

## 4. What this does *not* solve

- **No prod-like data in CI.** The fixture is a *shape*, not a copy — a migration can still be wrong
  for a row we never imagined. Real insurance is P4's dump, not the test.
- **No down-migrations.** We do not write them; recovery is "restore the dump".
- **No shadow database with the previous release's real rows.** Possible later (`pg_dump` of prod
  into a scratch DB as a deploy step), deliberately not in scope.
- **Not a substitute for reading the SQL.** P3 catches three shapes; a wrong `UPDATE … WHERE` is
  invisible to it.

## 5. Open questions (yours)

1. **Prod's existing data: fresh start or backfill?** This is still §7.6 of `done/multi-team.md` and
   it decides P2's shape. Today: wipe `pg-data` (`docker compose down -v`) and let the empty-DB path
   apply, or keep the data.
2. If backfill: **legacy team name + slug** — default `Team` / `default` (matches the old
   `ensureAccess` bootstrap).
3. If backfill: **who is captain** — the old `user.role = 'captain'` row, or a given Discord id.
4. If backfill: **who becomes a member** — every row in `user` as `active` (the old `status` was
   `pending`/`active`, and `0003` already maps pending → active), or only previously `active` ones.
5. **Where do dumps live and how long?** `pg-backups` volume, `BACKUP_KEEP_DAYS` (7) already applies
   to the backup script; should the pre-migration dump share that retention, or be kept longer?
6. **Does the entrypoint still migrate on boot once P4 exists**, or does the deploy become an
   explicit `docker compose run --rm migrate` step that `app` waits on
   (`depends_on: service_completed_successfully`)? The second makes a failed migration a *failed
   deploy* instead of a crash-looping container — attractive, but it is a deploy-shape change.
