/**
 * One barrel for the shared vocabulary, kept free of logic on purpose.
 *
 * Each subject lives in its own module — `team`, `riot`, `profile`, `availability`, `pool`, `match` — so a reader
 * opens the file they mean instead of scrolling a 200-line list, and a caller still writes
 * `@lol/shared` without knowing the layout. Nothing in this codebase imports a deep path, so the
 * module split is invisible outside this package.
 */

export * from './availability.ts'
export * from './champion-stats.ts'
export * from './hexserve.ts'
export * from './manual-match.ts'
export * from './match.ts'
export * from './match-lanes.ts'
export * from './match-stats.ts'
export * from './pool.ts'
export * from './profile.ts'
export * from './riot.ts'
export * from './team.ts'
