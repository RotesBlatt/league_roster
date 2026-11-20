# Idea — captains rename their team (and its URL)

**Status:** done — 2026-11-20. Landed across `e6fff59`…`222036e`: `renameTeam` (name, short name,
slug in one statement), `PATCH /api/teams/:slug` behind the `teamCaptain` guard, the draft/message
rules `team-rename.ts`, the `TeamSettingsCard` on the admin page with a Save button, and the
`teamRole` fix that the work exposed. The slug **follows the name** (§2, option A); keeping old
slugs alive as redirects was deliberately not built — see §6.
**Depends on:** the slug rules and `teamCaptain` guard from `multi-team.md` (§7.2 and §11.2).
**Related:** `web-architecture.md` — `AdminPage` grew again here.

## 1. The ask

A captain wants to fix a typo in the team name, or change it outright. The team row already had
`name`, `shortName` and a `slug` derived from the name at creation, and nothing could edit any of
the three: `usage`-style edits did not exist, so the only way to "rename" was to create another
team and abandon the old one.

The question that decides the whole shape: **does the slug change with the name?**

## 2. The slug decision

| option | rename changes the URL | cost |
| --- | --- | --- |
| **A. slug follows the name** | yes | old links 404; the SPA must navigate after saving; uniqueness/reserved checks apply to a rename |
| B. slug frozen at creation | no | the URL drifts from the name forever |
| C. A + keep old slugs as redirects | yes, old links still work | a `team_slug_history` table and a fallback lookup in the auth guard |

**Chosen: A.** It is what `multi-team.md §11.2` already says about slugs ("derived, never typed"),
and the only people holding links to a team are its own captains and members, who are one click
away from the new URL. B was rejected because a team called "Löwen" living at `/t/die-besten/`
is a support ticket generator. C is a real idea, not a rejected one — recorded separately as
[`team-slug-history.md`](../team-slug-history.md).

Consequence that shaped the API: the rename **answer must carry the new slug**, and the client must
navigate rather than refetch. A rename that keeps the slug (only the tag, or only the letter case
of the name) answers with the same slug and stays where it is.

## 3. The API

`PATCH /api/teams/:slug`, body `{ name, shortName? }`, guard `{ teamCaptain: true }` — the same
guard every other tenant route uses, so a captain of team A hitting team B gets **404**, byte for
byte the answer for a team that does not exist. That is `multi-team.md §11.3` applied to a write:
the caller never learns whether the other team exists.

Three things that were not obvious:

1. **It is not a `TeamScope` route.** `forTeam` makes "every query carries `teamId`" structural,
   and the `team` table has no `teamId` — it *is* the tenant. The route takes the plain `Db` plus
   the guard's team row and updates `where(eq(teams.id, team.id))`, so the path slug and the
   written row cannot diverge. It therefore carries its own `/teams/:slug` prefix instead of
   joining the group in `app.ts`, which only hands out scopes.
2. **The unique index is the collision test.** `createTeam` avoids a race with
   `onConflictDoNothing … returning()`; an `UPDATE` has no such clause. A first attempt guarded the
   update with `NOT EXISTS (select 1 from team where slug = …)` inside the statement — and that
   subquery seen from the row being updated blocks renaming a team to **its own** name, which is
   the most common rename of all ("fix the capitalisation"). One `UPDATE … RETURNING` plus a caught
   `23505` is both simpler and race-proof: a row never collides with itself, and two captains
   renaming to the same slug get the same 409 as a plain collision.
3. **`shortName` has three states**, and they differ from the create form's: omitted means *keep
   the current tag*, `''`/blank means *clear it*, anything else means *set it*. `draftRename` in
   the web always sends the field for that reason, while `draftTeam` omits it when blank —
   `createTeam` treats omitted and blank as the same NULL, `renameTeam` cannot.

Statuses carry the difference you can act on, exactly as in `createTeam`: 422 for an unusable or
reserved name (your input is wrong), 409 for a name another team already owns (your input is fine).

## 4. The web

- **`team-rename.ts`** (plain module, no DOM): `draftRename({ currentName, currentShortName, name,
  shortName })` → `{ ok, body, unchanged }` or `{ ok: false, message }`, and `renameMessage`.
  `unchanged` compares trimmed values, so the Save button is disabled for a no-op save — including
  the `null` tag vs empty field case — and any real edit, even a case-only one, enables it.
- **`TeamSettingsCard`** (the wiring): seeds its state once from the team, so it is mounted with
  `key={team.id}`. On success it seeds the switcher's cached row with the answer **before**
  navigating; without that, `AdminPage` cannot find the team under its new slug for a frame and the
  card blanks. Then it invalidates `['teams']` and `['me']` for the server's truth.
- **`teamRole.ts`** was not planned. `AdminPage` decided `isCaptain` from `useMe()` — and `/api/me`
  is documented as the **oldest** membership, so an account that was a plain member of an older
  team and captain of the one in the URL was redirected off its own admin page. The card made that
  visible. The rule now comes from the `GET /api/teams` list, which carries a per-team `role`, as a
  pure `teamRole(teams, slug)` → `'loading' | 'captain' | 'denied'`; `'loading'` renders nothing,
  because answering "denied" on the first render would redirect a captain during the fetch.

## 5. Test map

| what | where |
| --- | --- |
| rename writes name, tag, slug; blank clears; omitted keeps; own-name rename; 409 leaves the row; 422 writes nothing | `apps/api/test/integration/teams.test.ts` |
| 401 / cross-tenant 404 (as a *captain* elsewhere) / 403 member / 200 + new slug routes + old slug 404s / 409 / 422 | `apps/api/test/integration/team-settings.test.ts` |
| draft trimming, `''` clearing, `unchanged` in all four directions, limits, messages | `apps/web/test/team-rename.test.ts` |
| prefilled fields, Save disabled until edited, `shortName: ''` sent, navigation on a new slug, same-slug stays, 409/422 shown | `apps/web/test/team-settings-card.test.tsx` |
| captaincy from the URL's team, `loading` never `denied` | `apps/web/test/team-role.test.ts` |

`AdminPage` itself still has no page-level test; the card and the role rule are covered instead.

## 6. Open / follow-ups

1. **Old slugs 404.** Option C — [`team-slug-history.md`](../team-slug-history.md) — is the fix if
   it ever hurts. Nothing is
   broken today; a bookmarked `/t/old-name/roster` is one create-team-form away from useless, which
   is why it was not built up front.
2. **`<Navigate to="/roster">`** in `AdminPage` names a route that does not exist, so a denied
   visitor falls through `*` → `HomeRedirect` → their *default* team's roster. It probably wants
   `/t/${slug}/roster`. Left alone: it changes where a non-captain lands, which is its own patch.
3. **Duplicated API surface, twice.** `renameMessage` mirrors `createTeamMessage` except for its
   404 case, and the t.Object body of `PATCH /teams/:slug` duplicates the one in `routes/teams.ts`.
   Both want a `refactor(...)` patch — `src/api-result.ts` and `lib/validate.ts` are the homes.
4. **`AdminPage` complexity** went 25 → 27 (already over the threshold). `web-architecture.md`
   is the plan; this feature added to the pile rather than paying it down.
