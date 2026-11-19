# Idea — from "one team" to "a team per captain"

**Status:** in progress — §8 steps 1–2 and the `/t/:slug` web routes landed (migrations
`0001`–`0003`). Step 3 (`POST /api/teams`) is still missing, so a fresh install still bootstraps the
`default` team (§10.4); the team switcher and step 5 (scoped `Db`, then RLS) are open too.
**Supersedes:** the assumption in `README.md` ("Roster app for one League team").
**Related:** `player-profiles.md` — who owns which field. Step 4 below assumes profiles exist.

## 1. The idea

Public landing page → "Sign in with Discord" → **"Create your team"** → you are that team's captain.
Anyone else joins only through that team's invite link. Teams are invisible to each other.

Consequence: the app becomes **multi-tenant**, with the tenant = the team.

## 2. The audit — what is single-tenant today

The current design is not merely "one team because we only seeded one". Tenancy-sensitive
concepts are baked into rows and into the bootstrap rule:

| Today | Where | Problem |
| --- | --- | --- |
| `user.role` (`captain`/`member`) | `db/schema.ts:23` | a property of the *team*, stored on the *global identity* |
| `user.status` (`pending`/`active`/`disabled`) | `db/schema.ts:24` | same — "pending" only means something relative to a team |
| "first account becomes captain" | `lib/access.ts:55-58` | global rule; with teams it is wrong by definition |
| `player` rows have no team | `db/schema.ts:80` | every roster read returns everyone's players |
| `invite` rows have no team | `db/schema.ts:98` | a code from team A would activate a user globally |
| `GET /api/members` returns all users | `routes/members.ts:17` | leaks every Discord account on the server |
| Routes are flat `/api/players`, `/api/members` | `app.ts:86-93` | the tenant appears nowhere in the request |

The hard constraint that shapes everything below: **`user` must stay global.** better-auth owns
that table and assumes one identity per Discord account (module 2 of the walkthrough). You cannot
put `teamId` on `user` without either one-team-forever or one account per team. So team-scoped
state has to move *off* `user` into a membership row.

## 3. The one decision everything else depends on

> **Can one Discord account belong to more than one team?**

- **Yes (recommended).** A `membership` table. Roles/status per team. Enables "one person, two
  teams", switching teams, and makes the captain-of-one-team case fall out naturally. Costs: team
  switcher in the UI, "which team am I acting as?" on every request.
- **No.** `user.teamId` + `user.role`. Far less code, but a person who forms a second team needs a
  second Discord account, and "leave team / join another" is a data migration. Almost certainly
  the wrong corner to paint yourself into.

Everything in §4–§7 assumes **Yes**.

## 4. Sketch of the target model

Not final — for discussion.

```text
team          id, slug, name, createdAt, createdBy → user.id
membership    id, teamId → team, userId → user, role, status, joinedAt
              UNIQUE (teamId, userId)
player        + teamId → team            (roster row)
invite        + teamId → team            (code is scoped to one team)
user          unchanged — global identity, no role, no status
```

- `role`/`status` **move** from `user` to `membership`. `role` keeps its enum; **`status` loses
  `pending`** (see §10) and becomes `active`/`disabled`, because a person who is not a member has
  no membership row at all — absence is the "not in this team" state.
- `players.userId` stays (a roster entry may be linked to a login), but `players.teamId` is what
  scopes reads.
- `better-auth` needs no changes at all — its four tables are untouched. Good sign.

**Invariant that replaces the bootstrap rule:** creating a team *is* the act that makes you its
captain. "First account wins" disappears entirely; the `ensureAccess` global branch is deleted and
replaced by per-membership lookup. This is a net simplification of module 3, not an addition.

## 5. The thing that will actually bite you: tenant leakage

Once `teamId` exists, every query is one forgotten `WHERE` away from serving another team's roster.
This is the #1 correctness risk of the whole change and deserves more care than the feature work.

Three ways to defend, cheapest first:

| Approach | Strength | Cost |
| --- | --- | --- |
| Discipline: every query takes `teamId` | none, once someone is tired | 0 |
| **Scoped access object**: `forTeam(db, teamId)` returns the only handle routes get | structural — you *can't* forget, the unscoped `db` isn't passed in | small, and matches the existing `(db) => routes` factory style |
| Postgres RLS with a per-request session var | real, DB-enforced, survives bugs | real work: connection-local var, leaks across pooled connections if done wrong |

Recommended: **scoped access object now, RLS later as defence in depth.** The codebase already
injects `Db` into route factories, so tightening that type to `TeamDb` is a natural step.

Also decide: a cross-team read returns **404, not 403** — don't confirm that the other team's
resource exists.

## 6. How the request learns which team it is

| Option | Shape | Verdict |
| --- | --- | --- |
| **Path-scoped** | `/api/teams/:slug/players`, `/t/:slug/roster` | explicit at every call site, Eden types stay honest, links are shareable. Verbose. |
| Session field | `session.activeTeamId`, flat `/api/players` | shorter URLs; but tenancy becomes implicit, "why am I seeing nothing?" bugs, and one stale session field can cross teams. |
| Header | `X-Team-Id` | invisible in logs and in types. |

Recommended: **path-scoped**, slug in the URL. Subdomains (`acme.example.com`) look nicer but
demand wildcard DNS + a wildcard TLS cert at deploy time — a decision for whoever owns the deploy,
not something to assume.

## 7. Open questions (yours, not mine to guess)

1. **Open or gated team creation?** Public "create team" invites spam teams. Options: open with
   rate limiting, Discord-account-age/server-membership gate, or invite-only during a beta.
2. **Slug rules.** Uniqueness, reserved words (`api`, `admin`, `login`, `join`), rename allowed?
3. **Team switching UI** if a user has two memberships: switcher in the sidebar, or last-used?
4. **Can a captain own more than one team?** If yes, ownership transfer needs a rule; if no, it
   needs an enforcement point.
5. **Deleting a team**: soft (`deletedAt`) or hard delete with cascade? Who can do it?
6. **Existing data**: the repo has `data/team.db` and a live install. Freeze → migrate → cut over,
   or fresh start? (Affects whether a backfill migration is written at all.)
7. **Should we adopt better-auth's `organization` plugin instead of hand-rolling?** It ships
   organisations, members, roles, invitations and an active-org concept (present in the installed
   `1.7.25`). Tempting, but its tables and role vocabulary would sit next to ours and we'd pay a
   translation layer for `captain`/`pending`/`player`. My read: **no for now** — our domain is
   small and specific, and a hand-rolled `membership` table is one table instead of a plugin's
   surface area. Worth revisiting if we ever need per-team granular permissions.

## 8. Suggested sequencing (each step lands green)

0. **Decide §3, §6, §7.1-7.4.** Nothing else is worth building before these.
1. **Schema**: add `team` + `membership`, add `teamId` to `player`/`invite`, drop
   `role`/`status` from `user`. Backfill one team for existing rows. Pure migration + tests.
2. **Tenant-scoped guards**: `{ member: true }` becomes "member *of the team in the path*";
   `ensureAccess` loses its bootstrap branch and reads `membership`. Regression tests: a user of
   team A gets 404 on team B's resources, and a *disabled* member of A gets 403.
3. **Landing page + `POST /api/teams`**: creator becomes captain in the same transaction.
   First test: two accounts each create a team, neither sees the other's roster.
4. **Web**: `/t/:slug/...` routes, team switcher, invite links carry the slug.
5. **Hardening**: scoped access object replaces raw `Db` in routes; then RLS.

## 9. What gets *simpler*

Worth saying out loud, since the change looks purely additive:

- the "first account becomes captain" branch and its race disappear;
- the `CAPTAIN_DISCORD_IDS` allowlist stops being a global escape hatch (it can become
  "seed captain of a named team", or go away);
- `GET /members` stops being a "list every account on the server" endpoint.

## 10. Decided while implementing steps 1–2

Recorded here because the code no longer matches the sketches above, and these were the
defensible-but-not-obvious calls:

1. **There is no approval queue.** A captain sees *only* their own team's members
   (`GET /api/teams/:slug/members` inner-joins `membership` on `(userId, teamId)`). An account
   that belongs to no team is invisible to every captain. Consequence: **an invite link is the
   only way in**, which is what §1 says anyway. A captain cannot approve a stranger by id.
2. **`pending` is removed** from `MEMBER_STATUSES` (migration `0003` maps any existing
   `pending` row to `active`, then sets the column default to `active`). The states are now:
   no row = not a member; `active`; `disabled`. `Me.status` is `MemberStatus | null`, where
   `null` means "no membership", which is different from "a captain disabled me".
3. **Cross-team and unknown-slug are the same answer: 404.** A team you are not a member of is
   indistinguishable from a team that does not exist — on reads and writes, including
   `PATCH /members/:id`.
4. **The guards never bootstrap.** Only `/api/me` (`ensureAccess`) still creates the `default`
   team for the first account, and the Discord allowlist still grants captain there. Until
   `POST /api/teams` exists (step 3), that is the only way a fresh install becomes usable.
5. **`/api/invites/claim` is global**, not under `/api/teams/:slug`: the code identifies the
   team, and the claimer is not a member yet, so a team guard would 404 them.

Still open from §7: slug rules (§7.2), whether team creation is open or gated (§7.1), team
switching (§7.3), ownership transfer (§7.4), team deletion (§7.5), existing data (§7.6).
