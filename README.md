# LoL Team

Roster / invite / coordination app for one League team. Replaces the Google Sheet.

- **Bun** workspace: `apps/api` (Elysia), `apps/web` (Vite + React + Mantine), `packages/shared`
- **Postgres 17** as its own compose service with a named volume (`pg-data`), accessed through
  **Drizzle ORM** migrations
- **Discord OAuth** via better-auth, captain-managed invites, no passwords
- Typed end-to-end: the web app imports the Elysia `App` type (Eden Treaty), so API changes
  break `bun run typecheck` in the UI instead of at runtime

## Services (docker compose)

| service | what                                                           | persistence            |
| ------- | -------------------------------------------------------------- | ---------------------- |
| `db`    | `postgres:17-alpine`, publishes `127.0.0.1:5432` for local dev | volume `pg-data`       |
| `app`   | Bun + API + built SPA on `:3001`                               | stateless, rebuildable |

`app` waits for the `db` healthcheck, then runs migrations on start, then serves.

## Local development

```bash
cp .env.example .env          # fill in Discord values; POSTGRES_PASSWORD is required

docker compose up -d db       # Postgres only (localhost:5432)
bun install
bun run db:migrate            # creates the schema
bun run dev                   # API :3001, Vite :5173 (proxies /api)
```

Open http://localhost:5173. `DATABASE_URL` in `.env` must point at `localhost` for this;
compose overrides it with host `db` for the container.

### Discord application (5 minutes)

1. https://discord.com/developers/applications → **New Application**
2. **OAuth2** → copy **Client ID**, **Reset Secret** → copy **Client Secret**
3. **OAuth2 → Redirects** → add **every** URL you actually open, one per mode:

   | how you run it              | origin                    | redirect URI                                        |
   | --------------------------- | ------------------------- | --------------------------------------------------- |
   | `bun run dev`               | `http://localhost:5173`   | `http://localhost:5173/api/auth/callback/discord`   |
   | `docker compose up` (local) | `http://localhost:3001`   | `http://localhost:3001/api/auth/callback/discord`   |
   | VPS                         | `https://lol.example.com` | `https://lol.example.com/api/auth/callback/discord` |

   Discord rejects any redirect_uri that is not on that list, and better-auth rejects a
   browser `Origin` it does not trust (`Invalid origin` in the logs).
4. Scopes stay default (`identify`, `email`).

Put both values in `.env` (`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`), plus a secret:

```bash
openssl rand -base64 32     # -> BETTER_AUTH_SECRET
```

Env is read **once at process start** — restart the dev server after editing `.env`.

### Who is captain?

- `CAPTAIN_DISCORD_IDS=123456789012345678` in `.env` → always captain + approved
- otherwise the **first account to log in** becomes captain (fresh install)

Everyone else who logs in is `pending` until a captain approves them in **Admin** or they
open an invite link `/join/<code>` created in **Admin → Invites**.

## Deploy on a VPS

```bash
cp .env.example .env
# prod values: PUBLIC_URL=https://lol.example.com   <- compose derives BETTER_AUTH_URL /
#              WEB_ORIGIN from it, so cookies and the OAuth redirect match the browser
#              BETTER_AUTH_SECRET, DISCORD_CLIENT_ID/SECRET, POSTGRES_PASSWORD
docker compose up -d --build
docker compose logs -f app
```

`PUBLIC_URL` is the only origin switch for compose (`BETTER_AUTH_URL` in `.env` is what
`bun run dev` uses). Local container test = default `http://localhost:3001`.

- The container serves the SPA and the API on the **same origin**, so cookies/sessions
  need no CORS setup.
- Only `:3001` is published. `db` is bound to `127.0.0.1` and never exposed publicly.
- Put your existing nginx/Caddy in front for TLS:

```caddyfile
lol.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

Update the Discord redirect URI to `https://lol.example.com/api/auth/callback/discord`.

### Backup / restore

```bash
# dump (keeps the db running)
docker compose exec db pg_dump -U lol lol | gzip > backup-$(date +%F).sql.gz

# restore
gunzip -c backup-2025-01-01.sql.gz | docker compose exec -T db psql -U lol -d lol
```

The volume survives `docker compose down`; only `down -v` deletes data.

## Scripts (run from the repo root)

| script                | what it does                                            |
| --------------------- | ------------------------------------------------------- |
| `bun run dev`         | API + Vite dev server together                          |
| `bun run build`       | builds the SPA into `apps/web/dist`                     |
| `bun run start`       | production-ish run of the API (serves `dist` too)       |
| `bun run typecheck`   | `tsc` across all workspaces                             |
| `bun run db:generate` | new migration after editing `apps/api/src/db/schema.ts` |
| `bun run db:migrate`  | apply migrations to `DATABASE_URL`                      |
| `bun run db:studio`   | Drizzle Studio                                          |
| `bun run check`       | Biome lint + format                                     |

## Layout

```
apps/api/src
  index.ts            routes + error handling, serves the SPA in prod
  auth.ts             better-auth (Discord, 30 day sessions)
  plugins/auth.ts     macros: { auth }, { member }, { captain }
  lib/access.ts       bootstrap + captain allowlist + pending gate
  routes/             me, players, invites, members
  db/schema.ts        better-auth tables + player + invite (pg)
apps/web/src
  api.ts              Eden client (typed against the API)
  pages/              Login, Join, Roster, Admin
  components/         AppLayout (AppShell), RequireMember guard, badges
packages/shared       roles/statuses shared by both sides
docker-compose.yml    db (postgres + volume) + app
```

## Not built yet (next slices)

1. Google Sheets import so the old data lands in Postgres
2. Availability per weekday + scrim/event calendar with attendance
3. Riot API rank sync (League-V4) storing `rank_snapshots`
4. SSE for live updates instead of refetch
