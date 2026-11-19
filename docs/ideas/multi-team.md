# Idea — from "one team" to "a team per captain"

**Status:** in progress — §8 steps 1–3 landed (migrations `0001`–`0004`): two accounts can each
create a team and neither sees the other's roster, and nothing is granted by signing in — the
`default`-team bootstrap and the `CAPTAIN_DISCORD_IDS` allowlist are gone (§11.6). Still open: the
create-team form that calls `POST /api/teams` and the team switcher (§8 step 4), then step 5
(scoped `Db`, then RLS).
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
- the `CAPTAIN_DISCORD_IDS` allowlist stops being a global escape hatch — it went away with the
  bootstrap (§11.6);
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
4. **The guards never bootstrap.** Only `/api/me` (`ensureAccess`) still created the `default`
   team for the first account. Kept as the only way a fresh install became usable until step 3
   landed — `ensureAccess` and the `default` team are gone now (§11.6).
5. **`/api/invites/claim` is global**, not under `/api/teams/:slug`: the code identifies the
   team, and the claimer is not a member yet, so a team guard would 404 them.

Still open from §7: whether team creation stays open or becomes gated (§7.1), team switching
(§7.3), ownership transfer (§7.4), team deletion (§7.5), existing data (§7.6).

## 11. Decided while implementing step 3

1. **Creation is open to any signed-in account** (§7.1). No Discord gate, no allowlist: `POST
   /api/teams` needs `auth: true` and nothing else. Rate limiting stays an open item, not a
   blocker — a spam team is one row and can be deleted.
2. **The slug is derived, never typed** (§7.2). `slugify(name)` lowercases, spells German letters
   out (`Löwen` → `loewen`, `Straße` → `strasse`), folds other accents (`é` → `e`), collapses the
   rest into hyphens and cuts to 32 characters. Reserved words (`api`, `admin`, `login`, `logout`,
   `join`, `t`, `teams`, `new`, `default`) are rejected.
3. **422 vs 409 carries the difference you can act on.** An unusable or reserved name is a 422 (your
   input is wrong); a name whose slug is already taken is a 409 (your input is fine, it is taken).
   The collision is detected with `onConflictDoNothing … returning()` inside the transaction, so a
   race produces the same 409 as a check-then-insert and never leaves a team nobody owns.
4. **`team.shortName` exists** (migration `0004`): a few characters for badges and the switcher
   (`DBW`), optional, at most 8, trimmed, blank means NULL. Not unique — it is a label, not a key.
5. **One account may create several teams.** Nothing counts or caps memberships; `createdBy` is the
   only trace of who made which team, and ownership transfer (§7.4) is still unwritten.
6. **The bootstrap and the Discord allowlist are gone** (§9). `getMe` is a plain read; there is no
   `ensureAccess` any more, no invented `default` team, and `CAPTAIN_DISCORD_IDS` is out of `env`.
   Removing them was not cosmetic: with the `default` team gone the allowlist would have meant
   "become captain of whichever team you are in", which is a cross-tenant privilege hole the
   moment one account is in two teams. `fresh-install.test.ts` is the regression test — the first
   account to sign in owns nothing, and the `team` table stays empty until someone creates one.
