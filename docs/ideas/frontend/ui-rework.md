# Idea — a UI rework (LoL palette, real icons, fewer pills, one centred column)

**Status:** idea, nothing implemented.
**Depends on:** nothing technical. It is a **foundation row**, not a dependency: it changes no
behaviour and no endpoint, but anything built afterwards (`team-home.md`'s cards, the matchday page)
should be built on the tokens this lands, otherwise it gets restyled twice.
**Interacts with:** `team-home.md` (new pages are the natural first consumers), `realtime.md` (both
touch `main.tsx`/providers — sequence the patches, don't overlap them), `web-architecture.md` (both
touch `RosterPage`/`AdminPage`; the refactor and the restyle must not share a diff).
**Introduces:** `apps/web/src/theme.ts` rewritten as tokens (§3), a `PageContainer` (§5), a `Tag`
component that replaces most `Badge` usage (§4), `lib/ui/role-icons.ts` + `lib/ui/rank-emblem.ts`
(§6), and an icon vocabulary module (§6.4).

## 1. The idea

The current UI is Mantine's defaults with one teal ramp on top: teal `brand`, a 56 px header with a
row of nav buttons on the left, `Badge` pills for every fact, tables edge to edge, and Inter
everywhere. It works and it is legible — it just doesn't *feel* like anything. This idea is a
presentation-only rework:

1. **Palette → League's own colours.** Hextech blue as the primary, Noxus red for danger, Void
   purple / Arcane pink as the secondary accents, gold as the highlight. Dark is the only scheme
   (as today).
2. **Fewer pills, and no pill that is just a word.** A `Badge` stays for *state*; labels become
   text, small square tokens, or icon + text.
3. **Real League art where it means something.** Position/role icons, ranked emblems for tier +
   division, champion icons (already there), item/objective icons later.
4. **One centred column.** Every page sits in the same `PageContainer`, centred, never edge to edge.
5. **Mobile is designed, not tolerated.** The page keeps working at 360 px because someone
   *decided* what it looks like there, not because Mantine shrank it (§5.1).
6. **Icons instead of, or beside, words** — a check mark on "saved", a small icon beside a nav
   label, an emblem instead of "Gold II".

Hard rule for the whole idea: **this is a skin, not a rewrite.** No route, query, guard, form or
business rule changes. If a patch needs a `.ts` file from `lib/` that isn't a pure presentation
mapping, it is not this idea.

## 2. What is wrong today, concretely

Inventory, so the rework has a checklist instead of a vibe:

| Where | Today | Why it reads as "generic" |
| --- | --- | --- |
| [`theme.ts`](../../../apps/web/src/theme.ts) | one 10-step teal ramp (`#e6fcf5` → `#087f5b`), `defaultRadius: 'md'`, Inter | one hue for everything = no hierarchy; the ramp is Tailwind's teal, not a design decision |
| header [`AppLayout.tsx`](../../../apps/web/src/components/AppLayout.tsx) | 56 px, nav as `Button variant={active ? 'light' : 'subtle'}`, patch chip + avatar on the right, content full width | the nav is three buttons that look like actions; the eye has no anchor; the page below is not aligned to the header |
| [`Badges.tsx`](../../../apps/web/src/components/Badges.tsx) | `RoleBadge` (fixed `w={64}`), `MainBadge`, `UnverifiedBadge`, `StatusBadge`, `RankBadges` | 5 pill types on one roster row; a fixed-width pill is a pill that truncates; role encoded as a Mantine colour name (`TOP: 'red'`, `MID: 'blue'`) that means nothing |
| [`PatchStatus.tsx`](../../../apps/web/src/components/champions/PatchStatus.tsx) | another `Badge`, in the header | a reference-data fact competing with the page's title for attention |
| [`WeekPlannerPage.tsx`](../../../apps/web/src/pages/WeekPlannerPage.tsx) | `maw={980}`, a `SegmentedControl` above a week switch above a grid | three stacked "what am I looking at" controls, two of them pills |
| [`RosterPage.tsx`](../../../apps/web/src/pages/RosterPage.tsx) / [`AdminPage.tsx`](../../../apps/web/src/pages/AdminPage.tsx) | `Stack`, no max width; `Badge`s inside table cells; `Table.ScrollContainer minWidth={640…820}` | at 2560 px the table stretches into unreadable line lengths; the `minWidth` hack is a symptom of the same thing |
| [`ProfilePage.tsx`](../../../apps/web/src/pages/ProfilePage.tsx) | `maw={640}` | the only page that is centred — three different layout conventions across five pages |
| `apps/web/src/**` | zero CSS files; every colour is a Mantine name string (`'brand'`, `'grape'`, `'teal'`, …) | colours are chosen per call site, so "the accent" is five different things |
| mobile, app-wide | **one** responsive declaration in the whole SPA: `visibleFrom="xs"` on the username ([`AppLayout.tsx:73`](../../../apps/web/src/components/AppLayout.tsx)). No `useMediaQuery`, no breakpoints, no burger/drawer | "works on a phone" currently means "nothing broke". See §5.1 |

## 3. The palette

League's visual identity is not one colour; it is a small set of **factions** used semantically. The
trap is using all of them decoratively — that is a rainbow, and it is exactly as anonymous as the
single teal ramp. So: **two families carry the UI, two accents carry meaning.**

| Token | Maps to | Mantine name | Used for |
| --- | --- | --- | --- |
| Hextech blue / cyan | `--lol-primary` | `brand` (renamed ramp) | primary buttons, active nav, focus ring, links, "current" states |
| Arcane gold | `--lol-gold` | `gold` | the one highlight per screen: the primary CTA's edge, the patch chip when current, a "main" marker |
| Noxus red | danger | `red` (Mantine's) | destructive actions, errors, disabled/lost |
| Void purple | `--lol-void` | `grape`/custom `void` | secondary emphasis: captain, history/past-week, "archived" |
| Arcane pink / magenta | `--lol-arcane` | `pink`/custom `arcane` | rare third accent — badges of *attention*, not of state |

Decisions to write down while implementing:

- **Backgrounds are not flat `#1a1b1e`.** A blue-black base (`#0a0e14`-ish) with a slightly lighter
  surface and a 1 px low-contrast border is what makes the accent read as light. This is a `Card`/
  `Paper` `defaultProps` change in `theme.ts`, not a per-page change.
- **One accent per screen, by rule.** If a screen needs gold *and* red *and* purple, the screen has
  a hierarchy problem; fix that instead of the palette.
- **Never rely on hue alone** for meaning: red/green must also carry an icon or a word (the planner
  already has this problem — see `availability` cells). Colour-blind safety is a `Tag` prop, not a
  wish.
- **Contrast target:** body text ≥ 4.5:1, large text ≥ 3:1 on the new background. Riot's own palette
  is not contrast-checked; ours has to be. The ramps get tuned, they are not copied.
- **Light mode: no.** `defaultColorScheme="dark"` stays, and `theme.ts` does not gain a light ramp
  it would have to keep in sync. Say this out loud so nobody "fixes" it later.

Ramps live as `MantineColorsTuple`s in `theme.ts` (that file is the whole restyle's single source of
truth, which is already its stated job: *"swap the ramp to restyle the whole app"*).

## 4. The pills

`Badge` is Mantine's *label with a filled background*. We use it for two different things, and that
is why it looks cheap: a 40-pill page has no focal point, and a pill around the word "main" is
chrome around a fact that could just be written differently.

Three rules:

1. **A pill is for a state, not for a label.** "disabled", "unverified", "past week", "no team" —
   borderline, but defensible. "main", "Gold II", "TOP" — not a state.
2. **A pill is never the only carrier of the information.** It can be *an* encoding (tone + icon),
   the text stays.
3. **No fixed widths, no `w={64}`.** A pill sized to its text is the only kind that survives a
   label change or a translation.

Replacement vocabulary — one component, `Tag`, with three shapes and a `tone`:

| Shape | Looks like | For |
| --- | --- | --- |
| `inline` | icon + text, no background | role, rank, patch, account marks — the default |
| `chip` | 1 px bordered, transparent, small radius (`sm`) | states that must be scannable in a table row |
| `marker` | 4 px coloured left edge (or a dot) + text | "main", "captain", membership state — colour without a box |

`tone` is an enum (`primary | gold | danger | void | muted | neutral`), not a Mantine colour string
at the call site. That single change is what stops `'grape'` vs `'violet'` vs `'teal'` drifting:
`Tag` maps tone → colour tuple in one place, and `lib/ui/tone.ts` is a pure function a unit test can
pin.

`RoleBadge` becomes `RoleTag` — **and it stops being a badge**: the position icon plus the role word
(`TOP`), `inline`, no box. The icon is the point; a coloured rectangle around "MID" never was.

## 5. Layout: one centred column

The ask was "everything centred, ~60 % of the screen, not edge to edge". The instinct is right; the
number needs a defensible version, because on a 1366 px laptop 60 % is 820 px and on a 2560 px
monitor it is 1536 px — the *same percentage* gives a different reading experience. What is actually
standard is a **max-width in `rem`/`px`, centred**:

- App content containers in the wild: **1140–1320 px** (Bootstrap `xl`/`xxl`), NICE Design System's
  default page width **1170 px**.
- Continuous text: **45–75 characters per line**, ~66 ideal; Tailwind's `max-w-prose` is `65ch`.
  ([web.dev](https://web.dev/learn/design/typography),
  [Baymard](https://baymard.com/research-articles/line-length-readability),
  [Bootstrap containers](https://getbootstrap.com/docs/5.2/layout/containers/),
  [Tailwind max-width](https://tailwindcss.com/docs/max-width))

So the rule, stated in a way that holds on every screen:

```text
PageContainer sizes (centred, mx="auto", w="100%")
  narrow   640px   auth, profile, single-card forms      ← 45–75 chars of prose
  default  72rem  (≈1152px)   every normal page          ← ≈60 % of 1920, 100 % of a laptop
  wide     88rem  (≈1408px)   planner grid, wide tables  ← the exception, not the default
```

- `72rem` is the answer to "60 %": on a 1920 px monitor that is 60 %, and it is *also* the right
  width at 1366 px (where 100 % of a 1366 px viewport minus gutters is already close to it).
- **`wide` must be justified per page** and the justification gets a comment. The availability grid
  is genuinely a matrix and earns it; the roster table probably does not — dropping
  `Table.ScrollContainer minWidth` and letting the table breathe inside `default` is the better fix.
- **The header uses the same container.** Otherwise the page content is centred and the logo/nav is
  not, and the whole thing reads as misaligned. Header, main and footer share one container
  component; the header's inner `Group` gets its `max-width` from it.
- **The shell becomes one component** (`AppLayout`) with the nav as *tabs*, not buttons: an underline
  or a left 2 px marker on the active item, same height as the header, no filled pill for the active
  state. Nav is a place, not an action — it should not look pressable in the same way a button is.
- **Mobile:** the container collapses to `100%` with a 16 px gutter — and that is stated as
  `min(100% - 2rem, 72rem)` so the centred column and the gutter are one rule. The rest of mobile is
  §5.1, because it is not one line of CSS.

### 5.1 Mobile: today it is a side effect, not a design

The honest state: the app is desktop-shaped and **has never been designed for a phone**. It mostly
survives one, which is why nobody has looked at it. That is exactly what this idea has to change,
or the rework ships a pretty desktop and the same accidental phone.

| Surface | What happens at 360 px | Verdict |
| --- | --- | --- |
| Header | team switcher + up to 3 nav buttons + patch chip + avatar in a single 56 px row | wider than the screen; only one element (`visibleFrom="xs"`) is aware of width at all |
| Roster / admin | `Table.ScrollContainer minWidth={820\|640\|620}` | an inner horizontal scroll inside a page that also scrolls, with the actions column off-screen |
| Planner | `COLUMNS = 46px repeat(7, 1fr)`, `ROW_HEIGHT = 16` ([`WeekGridFrame.tsx`](../../../apps/web/src/components/planner/WeekGridFrame.tsx)) | ~40 px day columns; a half-hour cell is 16 px tall — below WCAG 2.2's 24 px target floor, and impossible to paint with a thumb |
| Tooltips | `Tooltip`, `title` on the champion placeholder | hover-only information does not exist on touch |
| Long labels | team names, `weekHeading`, member names | no `truncate`, no defined wrap point |

The rules, so the patch is reviewable against something:

1. **Breakpoints are declared once**, in `theme.ts` (`xs 36em`, `sm 48em`, `md 62em`, `lg 75em`,
   `xl 88em`), and the shell/container read them. No page invents its own `px`.
2. **The nav is a declared mobile pattern, not shrinkage.** A burger opening a `Drawer`, with the
   team switcher and the avatar staying in the bar — or a bottom bar capped at four items. The
   drawer is the recommendation: there are more destinations than a thumb bar wants, and the team
   switcher needs a home (open question 5).
3. **A table gets a mobile shape, not a scrollbar.** Roster and admin become a list: role icon,
   name, rank emblem, and the row's actions in a `Menu`. Horizontal scrolling stays a last resort
   for the justified `wide` grid, never the mobile story.
4. **The planner is the one real mobile problem, and it is allowed to look different.** One day at a
   time, 30-minute rows at ≥ 28 px, a day pager (swipe is a bonus, not a requirement); the
   seven-column week stays the desktop view. Critically: **the difference is data, not a second
   grid** — `WeekGridFrame` takes `visibleDays: number[]` and `COLUMNS` becomes a pure
   `columnsFor(days)`, so the geometry stays in `lib/planner` and stays unit-tested. A copy of the
   grid that drifts from the original is the failure mode to avoid.
5. **Tap targets ≥ 44 px**, never under 24 px (WCAG 2.2 SC 2.5.8). `size="xs"` buttons in dense
   rows are a mouse affordance: on mobile the *control* changes (row → menu), not just its padding.
6. **No hover-only information.** Every tooltip needs a visible label or a tappable popover on
   touch — which is the same requirement §6.4 already puts on icons (text neighbour or
   `aria-label`).
7. **Nothing is designed below 360 px.** Check 360 and 390 px portrait and 740×360 landscape.

Verification caveat, stated so nobody pretends otherwise: happy-dom cannot prove layout. The
provable part is the pure geometry (`columnsFor(days)`, the visible-day list, `PageContainer`'s
sizes); the rest is a resize checklist plus a 390 px screenshot next to the 1920 px one in the
patch report (§8).

## 6. Icons and League art

The goal is "more life", and the cheap way to get it is one icon per fact, chosen once, mapped in
data. Scattered `<IconFoo />` in JSX is how icon vocabularies rot.

### 6.1 Position / role icons

Riot's five position glyphs (top, jungle, middle, bottom, utility). Candidates, **to verify at
implementation, not guessed into code**:

```text
raw.communitydragon.org/<patch>/plugins/rcp-be-lol-game-data/global/default/assets/…   position icons
raw.communitydragon.org/<patch>/plugins/rcp-fe-lol-…/global/default/…                  champ-select svgs
```

The mandate from `hexserve-champion-data.md` §7 applies unchanged: **a missing asset is a
placeholder, never a throw.** If the position icon 404s, `RoleTag` renders the role word alone.
`lib/ui/role-icons.ts` maps `Role → { src, label }` and is a pure module (unit-tested: all five roles
present, no `undefined`, unknown role falls back to text).

### 6.2 Rank emblems (tier + division)

Ten tiers × four divisions is not forty assets — Riot ships **one emblem per tier** plus a division
marker, and the emblems are the recognisable part. So:

- `RankTag` = emblem (tier) + "Gold II" text + queue word, `inline`.
- Master/Grandmaster/Challenger have **no division** — `rankLabel()` already enforces that
  (`lib/profile/rank.ts`); the emblem path must be derived from the same `Tier` union so a fake
  "Challenger IV" cannot get a crest either.
- `TIER_COLORS` survives as the *fallback* when the image fails to load, so a broken asset still
  reads as "Gold".

### 6.3 Champion icons

Already correct (`ChampionIcon`/`ChampionLabel`, `hexserve-champion-data.md`). No change beyond
sizing and the `radius` becoming a token.

### 6.4 Icon vocabulary for text

A small table in `lib/ui/icons.ts` (or a single `iconFor(kind)` function):

| Fact | Icon | Where |
| --- | --- | --- |
| saved / verified | `IconCheck` | forms, account rows |
| unverified | `IconAlertTriangle` | account rows |
| main account | `IconStarFilled` (gold) | account rows |
| captain | `IconCrown` (void) | roster, admin |
| disabled | `IconBan` | admin |
| past week / history | `IconHistory` | planner |
| patch current / stale | `IconClock` vs `IconRefresh` | `PatchStatus` |
| sub / coach | `IconUserPlus` / `IconWhistle` | roster |

Accessibility, because this is the part that gets forgotten: an **icon beside text is
`aria-hidden`** (the text already says it); an **icon-only** control needs `aria-label` and a
tooltip, never a title alone (invisible on a phone — same rule `ChampionIcon` already follows).

### 6.5 The legal box, stated once

League art in a fan project is allowed under Riot's fan-project policy, but it is **non-commercial**
and must not imply Riot endorses or runs this site: no Riot logo as *our* logo, no "official", no
merch, and the note in the footer that League of Legends is Riot's property. This is a decision, not
a footnote — it constrains "use the League icons" to "use them **as labels**, not as branding".

## 7. What does **not** change

- No route, query key, endpoint, guard, migration, DTO or business rule.
- The planner's grid logic (`lib/planner/*`), `api-result.ts`, `badges.tsx`-style mappings: these are
  already plain modules *because* they are testable, and that stays true. Restyling must not move
  logic into components. The one permitted addition is the `visibleDays` parameter of §5.1 — a
  geometry input, still pure, still unit-tested, still the only place that knows the week's shape.
- The dark-only scheme, Inter as body font (a display font is a separate, later idea).
- `bun run test` / `test:db` / `typecheck` / `check` staying green.

## 8. Verification

Presentation work has no integration test, so its proof is (a) the pure modules it adds, (b) a
checklist a human walks:

1. **Pure modules get unit tests** (no DOM): `tone.ts`, `role-icons.ts`, `rank-emblem.ts`,
   `PageContainer`'s size map, `iconFor()`. This is the same line `web-architecture.md` draws —
   mappings are code, JSX is not.
2. **One component test where behaviour exists**: `Tag` renders the tone class/prop and marks
   decorative icons `aria-hidden`; `RankTag` shows "Challenger" with no division
   (`test/components/ui/tag.test.tsx`).
3. **Visual checklist per page**, at 1366 px and 1920 px: contents centred and equal left/right
   gutter; header aligned to content; one accent per screen; no pill wider than its text; every icon
   has a text neighbour or an `aria-label`; no horizontal scroll except the justified `wide` grid.
4. **The same checklist at 360 px and 390 px**, plus: header fits one row without clipping; the nav
   is reachable (burger/drawer or bottom bar); no table scrolls sideways as its mobile story; every
   target is ≥ 44 px; every tooltip's fact is also visible or tappable; the planner is usable with a
   thumb. A page that only passes (3) is not done.
5. **Screenshot before/after** in the patch report — the diff of a restyle is unreadable, the
   pictures are the review. Desktop *and* one phone width, side by side.

## 9. Slices (one patch, one commit, in this order)

Deliberately small: this is the largest visual change in the project and the review rhythm in
`AGENTS.md` is one idea per patch. Each slice is independently green and mergeable.

| # | Patch | Touches | Red until |
| --- | --- | --- | --- |
| 1 | **Tokens**: rewrite `theme.ts` — blue/gold/void/pink ramps, surface + border, radius, `Tag` colour mapping | `theme.ts`, `lib/ui/tone.ts` + test | nothing (everything inherits) |
| 2 | **Shell + container**: header aligned to a centred container, nav as tabs, `PageContainer` | `AppLayout.tsx`, new `components/layout/PageContainer.tsx` | pages not yet using it |
| 3 | **`Tag` + kill the pills**: `Badges.tsx` → `RoleTag`/`RankTag`/`StateTag`; delete `w={64}` | `Badges.tsx`, `Tag.tsx`, roster/admin/planner call sites | — |
| 4 | **Icons**: `role-icons.ts`, `rank-emblem.ts`, `iconFor()`; `PatchStatus` moves out of the header | `lib/ui/*`, `PatchStatus.tsx`, header | missing asset = placeholder |
| 5 | **Page-by-page width + typography**: roster, admin, planner, profile, auth pages onto `PageContainer` | one page per patch if needed | — |
| 6 | **Mobile**: declared breakpoints, nav drawer, roster/admin list shapes, planner day view (`visibleDays` + `columnsFor`) | shell, `WeekGridFrame.tsx`, `lib/planner/*` + test | — |

Slices 1–2 are invisible-but-everywhere; 3–6 are the ones you can look at. Do not merge 1+3. Slice 6
is deliberately last: it is the largest behavioural-surface change (the planner's shape) and it is
much cheaper once the container and the tags are settled. It is also the one slice that can be split
per page without hurting anything.

## 10. Open questions (for the human, not the implementer)

1. **How far does "rework" go?** Skin only (this doc) or is there also a *structural* change in mind
   (a home page, a left rail, cards instead of tables)? The latter is `team-home.md` and should be
   its own idea — mixing them makes both unreviewable.
2. **Position icons vs. text:** icon-only in the roster table (compact, needs a tooltip) or icon +
   word (wider, unambiguous)? Recommendation: icon + word in the table, icon-only once
   `team-home`'s roster-by-role cards exist.
3. **Logo / wordmark:** does the team get one? A rework without a mark still looks like a template,
   and a mark is the one asset we cannot borrow from Riot (§6.5).
4. **Own art vs. Riot art:** if Riot's asset paths turn out to be unstable, do we vendor the five
   position glyphs and ten tier emblems as small local SVGs (licence note required) or accept
   placeholders when they move?
5. **Mobile nav: drawer or bottom bar?** Recommendation is the drawer (destinations outnumber a
   thumb bar, and the team switcher needs to stay reachable), but a bottom bar with four items is
   the more app-like feel if that is the goal — it is a taste call, not a technical one.
6. **Is mobile a first-class target or a "must not be broken"?** This doc assumes the former: the
   roster/admin list shapes and the planner's day view are real design work, not a media query. If it
   is only the latter, slice 6 shrinks to the drawer plus a max-width — and the planner stays
   unusable on a phone, which should then be said out loud instead of discovered.
