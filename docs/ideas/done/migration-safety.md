# Idea — a migration can never take prod down again

**Status:** done (2026-11-21) — commits `70d663c`, `05a3e29`, `b6419a3`, `091c3bb`, `6fec07c`.
Static rules reject unsafe SQL shapes, every migration from `0003` on is replayed against a seeded
database, migrations are serialised by an advisory lock, and `docker compose up` will not start the
app unless a pre-migration dump succeeded. The backfill (P2) and the image-vs-legacy fixture (P5)
were deliberately dropped.
**Scope:** `apps/api/drizzle`, `apps/api/test/integration`, `apps/api/test/unit`,
`apps/api/src/db/migrations.ts`, `docker-compose.yml`, `.github/workflows/ci.yml`, `AGENTS.md`.

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
  NOT NULL` — the same shape, and it fails as soon as `membership` has one row. **Decision:** both
  stay as shipped. No live database replays them, and editing history buys nothing; the point is
  that the *next* migration cannot repeat the shape.

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

- **Backups precede migrations, always.** The deploy dumps before the app (and therefore its
  entrypoint migration) starts, and refuses to start if the dump fails.
- **Destructive statements are a decision, not a line of SQL.** `DROP COLUMN` / `DROP TABLE` /
  `SET NOT NULL` need a backfill or an explicit allowlist entry with a reason.

## 3. What landed, in order (one idea per commit)

### 1. Ban the shape, not the instance

`apps/api/test/unit/migrations-safety.test.ts` parses `apps/api/drizzle/*.sql` and fails
`bun run test` on:

- `ADD COLUMN … NOT NULL` without `DEFAULT`
- `ALTER COLUMN … SET NOT NULL` with no preceding `UPDATE` in the same file
- `DROP COLUMN` / `DROP TABLE` without an allowlist entry (file → statement → reason)

The allowlist holds the five historical statements and is checked for stale entries, so it cannot
quietly grow. Milliseconds, no infrastructure.

### 2. Replay every migration against rows

`test/integration/helpers.ts` gains `migrateTo(db, count)` (the migrator already accepts a slice of
`readMigrationFiles`) and `createTestContext({ migrate: false })`.
`test/integration/migrations.test.ts` then, for every step from `0003` on: applies the prefix,
inserts one row into **every** table that exists at that point (values from `information_schema`,
foreign keys bypassed), applies the rest, and asserts every seeded primary key survived. No fixture
per migration and no list to maintain — a new `0005` is covered the moment it lands.

Starting at `0003` is deliberate: `0001`/`0002` are the historical offenders above. Pointing the
harness at step 1 reproduces the incident verbatim (`23502 … "teamId" … contains null values`),
which is how it was shown to catch the class.

### 3. Serialise migrations

`src/db/migrations.ts`'s `runMigrations` holds `pg_advisory_lock` on a reserved connection, so two
replicas booting at once cannot race on the schema; `migrate.ts` is now a thin CLI over it.
`migrations-lock.test.ts` proves a second replica blocks until the lock is released and that the
chain is applied exactly once.

### 4. Dump before migrating

`docker-compose.yml` has a one-shot `pre-migrate` service that runs `docker/backup.sh once` into
`pg-backups/pre-migrate`, and `app` waits on `service_completed_successfully`. A failed dump means
the app — and therefore its entrypoint's migration — never starts. The `package` CI job asserts that
wiring with `jq` over `docker compose config --format json`.

## 4. What this does *not* solve

- **No prod-like data in CI.** The seeded rows are a *shape*, not a copy — a migration can still be
  wrong for a row we never imagined. Real insurance is the dump, not the test.
- **No down-migrations.** We do not write them; recovery is "restore the dump".
- **No shadow database with the previous release's real rows.** Possible later (`pg_dump` of prod
  into a scratch DB as a deploy step), deliberately not in scope.
- **Not a substitute for reading the SQL.** The static rules catch three shapes; a wrong
  `UPDATE … WHERE` is invisible to them.
- **Bare `docker run` does not dump.** The pre-migration dump is wired in `docker-compose.yml`; the
  image on its own (CI smoke test, ad-hoc runs) is not covered.

## 5. Decisions while implementing

- **No backfill.** `0001`/`0002` stay shipped; no database replays them. The guarantee is about the
  next migration, not repairing history.
- **`0001`/`0002` are allowlisted, not fixed.** They are the only entries, each with a reason, and
  the static test fails if an entry stops matching.
- **The seeded replay starts at `0003`.** Pointing it at `0001` would only re-fail history; from
  `0003` on, every new migration is covered with no list to maintain.
- **Pre-migration dumps share the daily retention** (`BACKUP_KEEP_DAYS`, 7) and live in their own
  `pg-backups/pre-migrate` subdirectory, so a dump cannot collide with a daily one.
- **The entrypoint still migrates on boot.** The dump is a `depends_on` dependency, not a separate
  `migrate` service; a failed dump is a failed deploy, a failed migration is still a failing
  entrypoint.
- **P5 was dropped on purpose.** Seeding the `package` smoke test with a `0004`-era fixture would
  prove the image against legacy rows, but the integration replay and the pre-migration dump cover
  the class; it stays a possible follow-up, not a TODO.
