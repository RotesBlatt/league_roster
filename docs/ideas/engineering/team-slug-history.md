# Idea — old team slugs keep working

**Status:** idea, nothing built. Depends on `team-rename` (done) — this is the deferred option C in
[`done/team-rename.md`](../done/team-rename.md) §2.
**Related:** [`done/multi-team.md`](../done/multi-team.md) §11.7 — the URL is the source of truth for
which team you are looking at, and this idea changes what `/t/<slug>` means: not "the slug a team
has", but "the slug a team had or has".

## 1. The gap

Renaming a team moves its slug (`Die Besten` → `/t/die-besten/`, renamed to `Die Löwen` →
`/t/die-loewen/`). Everything old answers **404**: a bookmark, a link in the Discord channel, a
pinned message from three months ago. The rename itself is fine — it is the *retired* slug that has
no answer.

This was accepted when option A was chosen: the people holding links are the team's own captains
and members, one click from the new URL. This doc records the fix for when that stops being true.

## 2. Sketch

A second slug per team, remembered:

```text
team_slug_history
  id         text pk
  teamId     text not null → team.id on delete cascade
  slug       text not null, unique
  createdAt  timestamptz not null   -- when it was retired
```

Written by `renameTeam`: when the slug actually changes, insert the old slug in the same
transaction as the update. Free side effect: the table is also a rename log ("this team used to be
called …"), which no other table records.

Three unexpected benefits, all free once the rows exist: a rename history per team, a way to steer
someone who typed an older name, and a genuinely nice error page ("that team is now called X")
instead of a bare 404.

## 3. Where the redirect lives — the open question

| option | where | cost |
| --- | --- | --- |
| guard-level: `resolveTeamAccess` falls back to history | API, every team-scoped request | API calls start answering 308s instead of 404s, which breaks the "cross-team and unknown-slug are the same answer" property (`multi-team.md` §11.3) |
| SPA-level: `/t/:slug/*` asks the API and `navigate`s | web | one extra request on a stale link; needs a route + an effect, and the API keeps its clean 404s |
| **bare-path 308**: a handler for `/t/<slug>` and `/t/<slug>/*` that 308s before the SPA fallback | server, outside `/api` | bookmarks work with no JS; does not touch `/api/teams/:slug` at all |

The third is the one worth trying first: it keeps the API's answers unchanged (a stale API slug
still 404s, which is what the isolation tests rely on) and it is the only option that helps someone
pasting a link into a browser. It does mean the SPA fallback stops being "everything that is not
`/api` or `/assets`", so that predicate wants a test.

## 4. Decisions it forces

1. **A retired slug can be reclaimed.** A team renames away from `die-besten` and back. Insert must
   tolerate the row already existing, and the "reclaim" must delete the history row it would
   otherwise redirect *to itself*. Unique on `slug` alone forbids the naive version.
2. **Or another team takes it.** Then either the new owner blocks the old redirect (unique conflict
   → the old team silently loses its link) or history slugs are reserved forever (a name is never
   reusable). Reserving forever is one line and no ambiguity; it is also the only option that
   cannot produce a redirect to the *wrong* team.
3. **Forever, or with a TTL?** Rows are tiny and the log is useful; no expiry proposed.
4. **Only slug changes matter.** A rename that keeps the slug (case-only edit, or a tag-only save)
   writes nothing.

## 5. Test plan (when built)

- renaming writes exactly one history row, with the old slug;
- a rename that keeps the slug writes none;
- `/t/<old>/roster` answers 308 → `/t/<new>/roster`, and `/t/<old>/admin` → `/t/<new>/admin`
  (the section is preserved, same as `teamPathWithSlug` on the client);
- `/api/teams/<old>/players` still 404s — the API's isolation answer must not change;
- reclaim: leave and return, then the old slug resolves to the team itself, once, with no loop;
- a second team cannot take a retired slug (or, if decision 2 goes the other way, the redirect is
  dropped deliberately, and that has a test too).

## 6. Why not now

Nothing is broken: the rename is a deliberate captain action, and a stale link is one search away.
This adds a table, a migration and a redirect rule to a page-load path — the kind of thing that is
cheap to add later and expensive to explain if it goes wrong. Recorded so the next "why does the old
link 404?" answer is a decision, not a shrug.
