import type { PoolPersonDto } from '@lol/api/schema-types'

/**
 * The pool page's small decisions, as plain functions (champion-pools.md §7).
 *
 * Nothing here renders: "how full is the team's set of pools" and "how old is this opinion" are the
 * two sentences the page adds to the data, and they are the two that go wrong quietly (a completion
 * line that counts the wrong thing, an age that reads "1 days ago").
 */

type Lists = PoolPersonDto['lists']

/**
 * Does this person have any list filled at all? A cleared pool and a never-saved one look alike.
 *
 * `wip` is deliberately left out, here and in `poolCompletion`: the chase lines are about being able
 * to draft, and a list of champions somebody is *learning* is a plan, not a pool. Counting it would
 * silently stop chasing a player who is not draftable.
 */
export function hasAnyChampion(lists: Lists): boolean {
  return lists.main.length > 0 || lists.situational.length > 0 || lists.blind.length > 0
}

/**
 * The chase line: how many of the roster have filled anything.
 *
 * `null` when there is nobody to count (a team with no roster must not read "0 of 0 filled") **and
 * when everybody is done** — a finished chase is not information, it is furniture.
 */
export function poolCompletion(people: readonly Pick<PoolPersonDto, 'lists'>[]): {
  filled: number
  total: number
  text: string | null
} {
  const total = people.length
  const filled = people.filter((person) => hasAnyChampion(person.lists)).length

  // nothing to show when there is nothing to chase: an empty roster, or everybody done. "all 5
  // filled their pool" is a status line for a state nobody has to act on, sitting in the same space
  // as the sentence that does matter.
  if (total === 0 || filled === total) return { filled, total, text: null }
  if (filled === 0) return { filled, total, text: 'no pool filled yet' }

  return { filled, total, text: `${filled} of ${total} filled their pool` }
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const pad = (value: number) => String(value).padStart(2, '0')

/**
 * "updated …" for one column, or `null` when the player never saved.
 *
 * `now` is passed in so the test does not have to fake a clock. A pool is an opinion: when it was
 * last touched is part of reading it correctly, which is why the pool header keeps `updatedAt` even
 * after a clear.
 */
export function poolAgeText(updatedAt: number | null, now: number): string | null {
  if (updatedAt === null) return null

  const elapsed = now - updatedAt
  // a clock that disagrees with the server (or a save one second in the future) is not an age
  if (elapsed < MINUTE) return 'updated just now'
  if (elapsed < HOUR) return `updated ${Math.floor(elapsed / MINUTE)} min ago`
  if (elapsed < DAY) return `updated ${Math.floor(elapsed / HOUR)} h ago`

  const days = Math.floor(elapsed / DAY)
  if (days === 1) return 'updated yesterday'
  if (days <= 14) return `updated ${days} days ago`

  // older than two weeks: the exact day is clearer than a bigger number
  const date = new Date(updatedAt)
  return `updated on ${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`
}
