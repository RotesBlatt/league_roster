/**
 * Team slugs are derived from the team name, never typed by the captain
 * (multi-team.md §7.2): `"Die Löwen"` becomes `/t/die-loewen/...`.
 */

export const SLUG_MIN = 3
export const SLUG_MAX = 32

/**
 * Words that would shadow one of our own paths, and `default` because the retired
 * bootstrap team used it. Compared against the *already slugified* value.
 */
export const RESERVED_SLUGS: readonly string[] = [
  'api',
  'admin',
  'login',
  'logout',
  'join',
  't',
  'teams',
  'new',
  'default',
]

/** German letters have conventional ASCII spellings; a plain NFD strip would eat the dots. */
const TRANSLITERATION: Record<string, string> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  ß: 'ss',
}

/**
 * Name -> URL segment: lowercase, German umlauts spelled out, other accents folded
 * (`é` -> `e`), everything else collapsed into single hyphens, cut to `SLUG_MAX`
 * without leaving a trailing hyphen.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[äöüß]/g, (letter) => TRANSLITERATION[letter] ?? letter)
    // separate the accent from its letter, then drop the accent (é -> e + ́ -> e)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug.slice(0, SLUG_MAX).replace(/-+$/, '')
}

/** Why this slug cannot be used, or null if it can. Shape only — collisions are a DB question. */
export function slugProblem(slug: string): string | null {
  if (slug.length < SLUG_MIN) return 'The team name is too short to build a URL from'
  if (slug.length > SLUG_MAX) return `The team name must stay under ${SLUG_MAX} characters`
  if (RESERVED_SLUGS.includes(slug)) return 'That name is reserved — pick another one'
  return null
}
