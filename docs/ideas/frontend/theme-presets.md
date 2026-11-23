# Idea — per-user colour presets (pick a palette, not a colour)

**Status:** idea, nothing implemented.
**Depends on:** `ui-rework.md` — its §3 tokens and its §4 `tone` enum are the seam this needs. Without
them every call site hard-codes a Mantine colour name and a preset has nothing to switch.
**Introduces:** a `Palette` type + registry (`apps/web/src/lib/ui/palette.ts`), a pure
`contrastRatio()`, `createThemeFromPalette()`, a storage module (`lib/ui/palette-storage.ts`), and a
picker in the account menu. Optionally later: a `profile.palette` column.

## 1. The idea

Every member picks their **palette preset** from the account menu — we design the presets, they
choose between them. The default is `arcane` (violet/pink, the `ui-rework` palette); the others are
League factions rendered in the same token language.

Not a colour picker, not a theme editor: **four to five curated palettes, each of which is known to
be readable.** A hex input would let a member build an unreadable app and then call it a bug.

This is deliberately a *separate* idea from the rework. The rework establishes that colour is a
token, not a string; this one exploits it. Landing them in one commit would mean the rework's review
is "did the design improve?" *and* "is the theme system correct?", which is two reviews.

## 2. Why presets and not a picker

| | Curated presets | Free colour picker |
| --- | --- | --- |
| Contrast can be guaranteed | yes, checked per preset by a test (§7) | no — every value is a new unknown |
| Design work | 4 × one afternoon, once | infinite, forever |
| Data model | one enum value | a blob of colours to version, migrate and validate |
| Failure mode | "this preset is a bit bright" | white text on yellow, and a bug report |
| Supportable | yes | no |

The picker is the feature people *ask* for and the one nobody can maintain. Presets give 90 % of the
joy — "the app looks like my faction" — for a bounded amount of design.

## 3. What a preset *is*

A preset is a plain object of the same slots `ui-rework.md` §3 defines. The theme is then built from
it; no page knows which preset is active.

```ts
// apps/web/src/lib/ui/palette.ts — pure data, no React, no Mantine import
export type Palette = {
  id: PaletteId                       // 'arcane' | 'hextech' | 'noxus' | 'ionia'
  label: string                       // shown in the picker
  brand: MantineColorsTuple           // 10 steps — the only interactive hue
  gold: MantineColorsTuple
  info: MantineColorsTuple            // reference/informational, never interactive
  danger: 'red'                       // a Mantine name: meaning hues are not re-themed
  surface: { base: string; raised: string; border: string }
  glow: string                        // one accent used for focus rings + the active marker
}
```

Three rules make four palettes still feel like one product:

1. **A preset changes identity, never meaning.** `danger` stays red(-family) in every preset;
   `success` stays green; rank tier colours (`TIER_COLORS`) stay as they are, because "Diamond is
   blue" is a *fact about League*, not a brand choice. A preset that repaints danger is a preset that
   lets a delete button look primary.
2. **The same relationships hold in every preset:** exactly one interactive hue (`brand`), exactly
   one highlight (`gold`), info is never clickable. That is what makes a preset a *skin* and not a
   second design.
3. **Every preset is dark.** A "light preset" is a different scheme, and it would need every token
   duplicated and re-tested — explicitly out of scope (`ui-rework.md` §3 already says dark-only).

### 3.1 The candidate presets

| id | Reads as | Primary | Highlight | Notes |
| --- | --- | --- | --- | --- |
| `arcane` | Arcane / void, the default | violet → magenta | gold | from `ui-rework.md`, ships first |
| `hextech` | Piltover, the client's own language | cyan → blue | gold | the one everybody expects; proves the seam immediately |
| `noxus` | Noxus, aggressive | ember red → orange | pale gold | the hard one: `brand` and `danger` are the same family, so danger *must* be distinguished by icon/word (the colour-blind rule becomes the design constraint) |
| `ionia` | Ionia, calm | jade → sakura | warm gold | proves the palette is not "hue rotation" — different saturation, different surface tint |

Noxus is worth keeping in the set precisely because it is the awkward one: if a preset can collide
with the danger family and still be safe, the token system is honest.

## 4. Where the choice is stored

| Option | Cross-device | Cost | Risk |
| --- | --- | --- | --- |
| `localStorage` only (v1) | no | ~20 lines, no route, no migration | a member on a new laptop sees the default |
| `profile.palette` column | yes | migration + route + guard + test + optimistic write | needs `localStorage` as a mirror anyway, or the first paint is the wrong palette |
| Both (mirror + truth) | yes | both of the above | two sources that can disagree for one frame |

**Recommendation:** `localStorage` first, because a palette is a **device preference**, not a fact
about the player — the same argument that kept `refetchOnWindowFocus` a client concern. If it turns
out people actually switch devices, add the column later with the localStorage value as the boot
cache. The column is a `NOT NULL DEFAULT 'arcane'` enum, so it is migration-safe by construction
(`migration-safety.md`'s rules), and the guard is the same `teamMember` guard as every other
profile write.

Explicitly rejected: a cookie (sends a design decision to the server on every request), a CSS file
swap (a preset then has to be a stylesheet, and the token tests stop meaning anything), and
`prefers-color-scheme` (we ship one scheme).

## 5. How the switch happens

```ts
// main.tsx
const palette = loadPalette()              // synchronous, falls back to 'arcane'
<MantineProvider theme={createThemeFromPalette(palette)} defaultColorScheme="dark">
```

- **Synchronous read before the first render.** It is a SPA (`createRoot(...).render(...)` already
  runs after the script loads), so there is no SSR/flash problem to solve — but there *is* a
  Safari-private-mode `localStorage` that throws on read, so the read is `try/catch` and the fallback
  is the default preset. That is a pure function with a unit test, not a hope.
- **Switching re-renders the provider** with a new theme object (no page reload, no route change);
  everything below re-reads the tokens. State that must survive the switch is React Query's cache,
  which is outside the provider — nothing to do.
- **The picker** is a `Menu` in the account dropdown (`AppLayout.tsx`), showing the preset label plus
  a three-swatch preview (surface, brand, gold). Not a settings page — it is one choice.

## 6. What this idea does **not** do

- No light mode, no custom colours, no uploading a theme, no per-team palette.
- No change to League art, tier colours, position icons or champion icons.
- No server work in v1 at all: no endpoint, no column, no migration.

## 7. Verification

This idea is unusually testable for a design feature, because its rules are arithmetic:

1. **`contrastRatio(a, b)` is a pure function**, unit-tested against known pairs (black/white = 21:1,
   identical colours = 1:1).
2. **Every preset passes the same test** (`test/lib/ui/palette.test.ts`): all slots present and
   non-empty; `brand`/`gold`/`info` are exactly 10 valid hex steps; **body text and `dimmed` on
   `surface.base` ≥ 4.5:1**; **`brand[6]` on `surface.base` ≥ 4.5:1** (the button fill is legible);
   **`brand[6]` fill against `danger` text/fill ≥ 3:1** (delete-next-to-save is distinguishable).
   Adding a fifth preset means adding a row, and the test is what keeps the fifth one honest.
3. **`palette-storage.ts`**: read → stored id; unknown/garbage id → default; `localStorage` throwing
   → default, no crash.
4. **One component test**: the picker writes the id and the document theme changes (happy-dom has
   `localStorage`) — the only place a DOM is needed.
5. **Manual, per preset**: a screenshot of the roster page in each palette, at desktop *and* 390 px.
   Contrast maths does not catch "the Noxus preset looks like a warning banner".

## 8. Slices

| # | Patch | Touches | Notes |
| --- | --- | --- | --- |
| 1 | **Extract the seam**: `Palette` type + registry with **one** preset (`arcane`), `createThemeFromPalette()`, `contrastRatio()` + tests | `theme.ts`, `lib/ui/palette.ts`, tests | behaviour-identical refactor: no visible change, so it reviews as a diff, not as taste |
| 2 | **Second preset** (`hextech`) + the palette test table | `lib/ui/palette.ts`, tests | proves the seam; no UI yet |
| 3 | **Picker + storage**: account-menu picker, `palette-storage.ts`, provider re-render | `AppLayout.tsx`, `main.tsx`, storage module | first user-visible slice |
| 4 | *(optional)* **`profile.palette`** + migration + route + guard, mirroring `localStorage` | api + web | only if the "new device" annoyance is real |

Slice 1 is the whole bet: if the tokens from `ui-rework.md` are actually semantic, slice 1 is a
mechanical move. If it turns out to be hard, that is a finding about the rework, and it is much
cheaper to learn it there than after four pages are styled.

## 9. Open questions

1. **How many presets?** Four is the proposal. Fewer feels like a gimmick ("we gave you two"), more
   than six is a maintenance tax with no design gain.
2. **Does the *logo* have a variant per preset?** A gold wordmark works on all four; a
   preset-coloured mark would need four marks (`ui-rework.md` §10.3).
3. **Does a captain get to set the team's default palette** for newcomers? Tempting, and rejected in
   this draft: the palette is personal, and a team default is a fourth storage location competing
   with the member's own choice. If it is ever wanted, it belongs in `team-home.md` as a team
   setting, not here.
4. **Do we verify presets against colour-blind simulation in CI?** Not automatable cleanly; the
   proposal is a documented manual check per preset, plus the rule that danger always carries an icon.
