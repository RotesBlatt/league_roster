/**
 * Postgres error introspection. Needed because a unique index is a *rule*, and a route should
 * answer it with a sentence instead of letting it become a 500.
 *
 * Drizzle wraps query failures in its own error and keeps the pg one on `cause` (sometimes two
 * hops down), so a plain `error.code` check silently never matches.
 */
const UNIQUE_VIOLATION = '23505'

type ErrorLike = Record<string, unknown>

/** Walks the `cause` chain and hands each object to `visit` until one returns a value. */
function findInChain(
  error: unknown,
  visit: (candidate: ErrorLike) => string | undefined,
): string | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== 'object') return undefined
    const found = visit(current as ErrorLike)
    if (found !== undefined) return found
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}

/**
 * A unique violation's constraint name; `''` when the index is anonymous.
 *
 * `constraint_name` is what **postgres.js** puts on the error — verified against the driver, not
 * assumed (`constraint` is the node-postgres spelling and is simply absent here).
 */
function constraintName(candidate: ErrorLike): string | undefined {
  if (candidate.code !== UNIQUE_VIOLATION) return undefined
  const name = candidate.constraint_name ?? candidate.constraint
  return typeof name === 'string' ? name : ''
}

/**
 * The violated constraint's name when this is a unique violation, otherwise null.
 */
export function uniqueViolation(error: unknown): string | null {
  return findInChain(error, constraintName) ?? null
}
