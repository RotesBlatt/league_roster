# Bugs — the bug queue

**This file is a queue, not an archive.** An entry exists for exactly one reason: the bug is not
forgotten before someone works on it. The moment it has a regression test, the entry is **deleted** —
the test that fails without the fix *is* the record, and it cannot rot the way prose does. The file
itself is permanent and stays when the table is empty: an empty queue is a clean queue, not a deleted
one.

## How to use it

- **Record only what you are asked to record.** This is filled on request ("note this, we'll do it
  later"), not by noticing things. A bug journal nobody reads is worse than none.
- **Recording is one patch, no code.** A row plus a section, while the repro is fresh. Mixing it with
  the fix destroys the "fails before, passes after" evidence.
- **Working a bug is one patch.** The failing regression test first, then the fix — and that same
  patch **deletes the row and the section here**. Nothing accumulates: a `Fixed` table would be an
  archive with no reader, and git already remembers what was deleted and why.
- **Ids are never reused.** `B1` means one bug forever, even after its entry is gone, so a commit
  message that cites it stays true. `Next id` below is the only thing a cleanup leaves behind — bump
  it when you add an entry.
- **One bug per entry.** "The header is wrong and also the admin page" is two entries.
- **Record what you saw, then what you think.** *Repro / actual / expected* are observed and
  trustworthy; *suspects* are hypotheses and are labelled as such. A guessed cause written down as
  fact is worse than no entry.

## States

| state | means |
| --- | --- |
| `open` | reproducible, not fixed |
| `blocked` | understood, can't be fixed yet (needs a decision, a dependency, a person) — the blocker is named in its section |

Severity is about the person, not the code: **blocker** = a normal flow cannot be completed;
**major** = it can, but wrongly or confusingly; **minor** = cosmetic, or only on an edge input.

## Open

**Next id:** `B3`

| Id | Sev | Area | Bug | Found |
| --- | --- | --- | --- | --- |
| [B1](#b1) | blocker | web / auth | A signed-out visitor to `/` sees "Could not load your profile" instead of the login page | 2026-11-23 |
| [B2](#b2) | major | web / team | A rename leaves the shell on the old slug: the switcher prints the raw old slug, and the URL does not move to the new one | 2026-11-23 |

---

## B1

| | |
| --- | --- |
| Bug | A signed-out visitor to `/` sees "Could not load your profile" instead of the login page |
| Sev | blocker — the first thing a new or logged-out person sees is an error |
| Area | `apps/web/src/components/RequireCompleteProfile.tsx` |
| Found | 2026-11-23 |

**Repro.** Sign out (or use a private window), open `/`.

**Actual.** A centred card: *"Could not load your profile"* / *"not signed in"*. Nothing is clickable
— no login button, no redirect. The address bar stays on `/`.

**Expected.** Redirect to `/login` (the same thing `RequireMember`, `WelcomePage` and `JoinPage`
already do for the same 401), preserving the intended destination if that is wanted later.

**Cause — confirmed by reading, not yet by a test.** The gate checks the *profile* failure before it
checks the *session* failure:

```ts
if (profile.isError || accounts.isError) {   // ← runs first
  … <Title>Could not load your profile</Title>
}
if (me.isError) {
  if (isUnauthorized(me.error)) return <Navigate to="/login" replace />   // ← never reached
  …
}
```

Signed out, all three queries fail with 401; `profile` loses the race to the more specific question,
"is this even a signed-in person?". `RequireMember`'s correct 401 handling is unreachable because it
nests *inside* this gate.

**Not a one-route bug.** Every route inside the gate goes through this component, so `/`,
`/t/:slug/roster`, `/t/:slug/planner`, `/t/:slug/admin`, `/t/:slug/profile`, `/new-team` all show the
card. `/login`, `/join/:code` and `/welcome` are outside the gate and handle their own 401s already —
so the surface is exactly "everything the gate wraps".

**Fix sketch.** Ask the session question first: if `me.isError` and `isUnauthorized(me.error)`, go to
`/login`; *then* treat a profile/account failure as the error card (and, ideally, also treat an
`isUnauthorized` on either of those as "signed out", since a session can expire between the queries).
The distinction to keep: a 500 is an error card, a 401 is a redirect.

**Test that has to change.** `apps/web/test/components/app-profile-route.test.tsx` currently pins the
error card for a failing profile read; the regression test is the *signed-out* render of the gate
asserting a redirect to `/login`, and the existing test stays for a non-401 failure.

---

## B2

| | |
| --- | --- |
| Bug | A rename leaves the shell on the old slug |
| Sev | major — the rename succeeds, but the app lies about where you are until you click a team |
| Area | `apps/web/src/components/team/TeamSettingsCard.tsx`, `TeamSwitcher.tsx`, `AdminPage.tsx` |
| Found | 2026-11-23 |

**Repro.** As a captain, open `/t/<slug>/admin`, change **Team name** so the derived slug changes,
Save.

**Actual.** Three symptoms, reported together:

1. the header's team switcher shows the **raw old slug** as its label (not the team name);
2. the address bar keeps the **old slug** — the tab does not move to the new URL;
3. opening the switcher and clicking the team *does* take you to the right place.

**Expected.** The URL moves to the new slug immediately (that is what `TeamSettingsCard` says it
does), and the header shows the team's **name** — a slug is never fit for a human to read.

**Observed vs. suspected.** Symptom 1 is explainable from code alone: `TeamSwitcher`'s label is

```ts
const label = current?.name ?? slug ?? 'Team'      // slug = teamSlugFromPath(pathname) ?? me.teamSlug
```

so a raw slug is printed **only** when `currentTeam(teams, slug)` misses — the component has no
loading state and no "unknown" state, it just degrades into showing an identifier. Symptoms 2 and 3
together imply the URL really stayed on the old slug, and the seeded team list had the new one.

The navigation decision itself is *covered* and green in isolation
(`apps/web/test/components/team/team-settings-card.test.tsx`: "…follows the new slug"), which is the
important clue: that test renders the card **without** `AppLayout`/`TeamSwitcher`. So the failure is
in the shell around the card, not in the card's rule.

**Suspects (ranked, none confirmed):**

1. **Cache ordering.** `onSuccess` seeds `['teams']` with the renamed row, *then* invalidates
   `['teams']`. If a `['teams']` fetch was already in flight from before the PATCH, its (stale)
   response can land after the seed and overwrite it — after which `currentTeam` misses, and the
   shell falls back to the raw slug. A `navigate` to a slug the list does not know is also a good way
   for the router to bounce back to the old page.
2. **Two sources for "which team am I".** The shell derives `slug` from the pathname **or**
   `me.teamSlug` — and `me` is invalidated, so it lags the rename by one refetch. Any render between
   the two prints the old slug, and if nothing re-renders afterwards, the stale look sticks.
3. **Keyed card, unkeyed rest.** `TeamSettingsCard` is keyed by `team.id` (so its form state survives
   a rename), which is right — but the *page* re-renders from `teams.data.find(row => row.slug === slug)`
   with `slug` from `useParams()`. If those two disagree for a render, `team` is `undefined` and the
   card disappears while the switcher shows the fallback label.

**Fix sketch.** (a) The label must come from the URL slug plus the team list, with an explicit
`Loading team…` state instead of `?? slug` — printing an identifier is never the right fallback.
(b) Make the post-rename cache update authoritative: seed, then `await refetchQueries(['teams'])`,
then `navigate`, so an in-flight stale response cannot resurrect the old row. (c) Regression test in
the shell, not the card: render `AppLayout` + `AdminPage` together, rename, assert the header shows
the **new name** and the URL is the new slug.

**Related.** `team-slug-history.md` deliberately 404s an old bookmarked slug; this bug is different —
the app itself keeps using the stale slug, so `team-slug-history` would not fix it.
