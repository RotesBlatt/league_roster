# Idea — get the logic out of the pages (View / ViewModel)

**Status:** idea, nothing refactored. Behaviour-preserving refactor, so it ships as
"a refactor that changes no behaviour" (one of the commit categories in `AGENTS.md`).

## 1. The complaint, stated precisely

`RosterPage` (248 lines) and `AdminPage` (294 lines) currently mix five different jobs:

1. **server state** — `usePlayers()`, `useMembers()`, `useInvites()`
2. **mutations + cache invalidation + toasts** — `save`, `remove`, `createInvite`, `revoke`, `updateMember`
3. **derived rules** — `isCaptain`, `colSpan`, "not linked" vs `#tag`
4. **form state** — Mantine `useForm`, `emptyValues`, `openEdit` mapping DTO → form values
5. **pure UI state** — modal open, `editing`

Only #5 belongs in the component. #1–#4 are what make the file long and what make it untestable
without a DOM.

## 2. Compose → React vocabulary

You're thinking in Compose terms; here's the honest translation, because two of the three map
cleanly and one doesn't.

| Compose | React equivalent | Notes |
| --- | --- | --- |
| `@Composable` | function component | same idea: pure render of given state |
| `ViewModel` | **a hook, or a plain module** | React has no first-class VM. A hook is the idiomatic home, but hooks can't be tested without React — which is why the *rules* must live in plain modules |
| `StateFlow` | **React Query's cache** (server state) / an external store (client state) | the cache is already a push-based observable; `useQuery` is the subscription |
| `MutableStateFlow` (private) | mutation functions that write the cache | `invalidateQueries` / `setQueryData` |
| `collectAsState()` | `useQuery()` / `useStore()` | |

**The important realisation: you already have the StateFlow.** React Query's cache is a hot,
observable, shared state holder with a current value, and components subscribe to it. The "UI gets
updates from a signal" property is already true for server data. What's missing is not a mechanism —
it's a **boundary**.

## 3. Three kinds of state, three homes

| Kind | Example | Home |
| --- | --- | --- |
| **Server state** | roster, members, invites, `me` | React Query cache. Never copy it into `useState`. |
| **Screen state** | "the roster form's current values", "is the save in flight" | a ViewModel hook + pure functions |
| **UI-local state** | modal open, which row is being edited | `useState` in the component. Leave it alone. |

Most of the pain comes from #1 and #2 being interleaved in the same function body.

## 4. Options (and what I'd actually pick)

| Option | What it is | Verdict |
| --- | --- | --- |
| **A. Pure feature modules + thin VM hook** | `features/roster/rules.ts` (plain functions) + `useRosterViewModel()` that glues query + rules + mutations | **Recommended.** No new dependency. The rules become unit-testable with zero React. |
| **B. Plain class + `useSyncExternalStore`** | a real ViewModel object with `subscribe`/`getSnapshot`, consumed by React | Closest to `StateFlow` semantics, testable outside React. More ceremony; you hand-wire query subscriptions. Worth it only if a screen's state gets genuinely complex. |
| **C. Zustand (`createStore`, vanilla)** | framework-agnostic store, `useStore` hook, works outside React | Good *if* cross-screen client state appears (see §7). Not needed for per-screen logic. |
| **D. TanStack Store** | signals-based, framework-agnostic, `@tanstack/react-store` adapter | Same niche as C, and it's from the team you already use for Query. Slight edge on conceptual fit ("signals"), but it's a second paradigm next to Query. |
| **E. XState** | explicit state machines | Genuinely tempting for `JoinPage`'s 5-state flow. Overkill for CRUD screens. |
| **F. Redux Toolkit / RTK Query** | full framework | Replaces Query, adds boilerplate. No. |
| **G. MobX** | observable classes, closest to `StateFlow` | Class-based, less idiomatic React today, and it would fight Query. No. |

**Recommendation: A now, C or D only when §7 forces it.** Adding a state library to solve "my page
file is long" is the classic over-correction — the length comes from *mixing* concerns, not from
lacking a store.

## 5. What A looks like for `RosterPage`

```text
features/roster/
  rules.ts          canEditRoster(me)            → boolean
                    toRosterRows(players)        → display rows (badge colour, "not linked", opacity)
                    toFormValues(player | null)  → FormValues
                    toPayload(values)            → API body ('' → undefined)
  useRoster.ts      useRosterViewModel()         → { rows, canEdit, form, save, remove, modal }
  RosterPage.tsx    renders rows + modal, calls viewModel.save(values)
```

- `rules.ts` — **pure, no React, no fetch.** Unit-tested directly. This is where `AGENTS.md`'s
  "extract the rule into a plain function" applies to the frontend.
- `useRoster.ts` — ~30 lines: `usePlayers()`, `useMe()`, the three mutations, `invalidateQueries`,
  toasts. No rules, no formatting.
- `RosterPage.tsx` — JSX only. If it needs an `if`, it's probably a rule that belongs in `rules.ts`.

The component stops knowing that a mutation exists; it calls `save(values)` and renders
`save.isPending`.

## 6. Testing story (the actual payoff)

| Layer | Test |
| --- | --- |
| `rules.ts` | plain unit tests, no DOM — `bun test`, fast |
| `useRoster.ts` | only if it holds real logic; otherwise covered by the page test |
| `RosterPage.tsx` | render states only (empty, rows, captain vs member) — the existing `require-member.test.tsx` style |

Today the rules are only reachable through a rendered page, which is why `apps/web/test` has three
files for four pages. This refactor is what makes the frontend testable at the same granularity as
`apps/api/test/unit`.

## 7. When a store *does* become necessary

Not now — but the multi-team idea will force it. Once there's a "current team", that's **client
state shared across screens**, and it has a known trap: a selected id that survives a background
refetch which deleted the thing it points at (a stale `teamId` after being removed from a team).
That's the case for a real external store (C or D) plus a derivation step, not for `useState` in
`AppLayout`.

So: **A now; revisit C/D when `multi-team.md` lands.** Don't build the store speculatively.

## 8. Risks

- **Ceremony for four pages.** Mitigation: refactor one page at a time, and only extract what is
  actually duplicated or actually a rule. A `useXViewModel` that just re-exports `useQuery` is worse
  than nothing.
- **Stale closures.** A VM hook that captures `editing` in a mutation callback can act on the wrong
  row. Keep mutation inputs as arguments (`save(values)`), never read component state inside them.
- **Hooks aren't testable without React** — that's the whole reason the rules go in `rules.ts`. If
  the split ends up as "one big hook", nothing improved.
- **Behaviour drift.** This is a refactor: the existing page tests are the safety net. Write the
  characterization test *before* moving code, per `AGENTS.md`.

## 9. Order

1. `RosterPage` → `features/roster/` (smallest surface, most rules).
2. `AdminPage` → `features/admin/` (two tables, more mutations).
3. `JoinPage` → `features/join/` (the `started` ref and the claim flow deserve a named module).
4. Re-evaluate: if `useRoster`/`useAdmin` share a mutation-toast pattern, extract it *then* — not
   before there are three examples.

## 10. Open questions

1. Do we want the VM hook to return **one state object** (`{ rows, canEdit, modal }`) or separate
   values? One object reads more like `StateFlow`; separate values re-render less.
2. Where do **toasts** live — in the VM hook (current behaviour, uniform) or in the component?
   Uniform is better; it keeps error handling in one place.
3. Do we adopt **C or D** at all, or is `useState` + Query enough even with teams? Decide when
   `multi-team.md` step 4 arrives, with a real screen to judge.
