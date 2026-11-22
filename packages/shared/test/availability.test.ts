import { describe, expect, test } from 'bun:test'
import {
  computeCoverage,
  findPlayWindows,
  MIN_PLAYABLE,
  MIN_SESSION_MINUTES,
  mergeIntervals,
  type PersonInterval,
} from '../src/availability.ts'

/** Minutes from midnight: 20:00. Short enough to keep the arithmetic readable. */
const at = (hour: number, minute = 0) => hour * 60 + minute

const person = (userId: string, start: number, end: number): PersonInterval => ({
  userId,
  start,
  end,
})

describe('mergeIntervals', () => {
  test('an empty day stays empty', () => {
    expect(mergeIntervals([])).toEqual([])
  })

  test('adjacent intervals become one — 9-12 and 12-15 is 9-15', () => {
    expect(
      mergeIntervals([
        { start: at(9), end: at(12) },
        { start: at(12), end: at(15) },
      ]),
    ).toEqual([{ start: at(9), end: at(15) }])
  })

  test('overlapping intervals become their union, never a double count', () => {
    expect(
      mergeIntervals([
        { start: at(9), end: at(13) },
        { start: at(10), end: at(12) },
      ]),
    ).toEqual([{ start: at(9), end: at(13) }])
  })

  test('a contained interval changes nothing', () => {
    expect(
      mergeIntervals([
        { start: at(9), end: at(15) },
        { start: at(11), end: at(12) },
      ]),
    ).toEqual([{ start: at(9), end: at(15) }])
  })

  test('disjoint intervals stay separate and come out sorted by start', () => {
    expect(
      mergeIntervals([
        { start: at(20), end: at(23) },
        { start: at(9), end: at(12) },
      ]),
    ).toEqual([
      { start: at(9), end: at(12) },
      { start: at(20), end: at(23) },
    ])
  })

  test('the input is not mutated', () => {
    const input = [
      { start: at(20), end: at(23) },
      { start: at(9), end: at(12) },
    ]
    const copy = structuredClone(input)

    mergeIntervals(input)

    expect(input).toEqual(copy)
  })

  test('until midnight is an ordinary end and merges with a neighbour — 23-24 and 22-23', () => {
    expect(
      mergeIntervals([
        { start: at(23), end: 1440 },
        { start: at(22), end: at(23) },
      ]),
    ).toEqual([{ start: at(22), end: 1440 }])
  })
})

describe('computeCoverage', () => {
  test('one person with two overlapping intervals counts once', () => {
    const coverage = computeCoverage([person('a', at(9), at(13)), person('a', at(10), at(12))])

    expect(coverage).toHaveLength(1)
    expect(coverage[0]).toMatchObject({ start: at(9), end: at(13), count: 1 })
  })

  test('two people, half overlapping, give three segments', () => {
    const coverage = computeCoverage([person('a', at(9), at(12)), person('b', at(10), at(15))])

    expect(coverage).toEqual([
      { start: at(9), end: at(10), users: ['a'], count: 1 },
      { start: at(10), end: at(12), users: ['a', 'b'], count: 2 },
      { start: at(12), end: at(15), users: ['b'], count: 1 },
    ])
  })

  test('a hand-over at noon stays two segments, so "who is free" is never a union', () => {
    // a is free 9-12, b is free 12-15: the count is 1 the whole day, the people never meet, so
    // merging on the count alone would claim both were free all afternoon
    const coverage = computeCoverage([person('a', at(9), at(12)), person('b', at(12), at(15))])

    expect(coverage).toEqual([
      { start: at(9), end: at(12), users: ['a'], count: 1 },
      { start: at(12), end: at(15), users: ['b'], count: 1 },
    ])
  })

  test('adjacent segments with the same people are merged into one', () => {
    // a boundary appears at 12 only because c stops there; a and b span it
    const coverage = computeCoverage([
      person('a', at(9), at(15)),
      person('b', at(9), at(15)),
      person('c', at(9), at(12)),
    ])

    expect(coverage).toEqual([
      { start: at(9), end: at(12), users: ['a', 'b', 'c'], count: 3 },
      { start: at(12), end: at(15), users: ['a', 'b'], count: 2 },
    ])
  })

  test('until midnight ends the last segment at 1440', () => {
    const coverage = computeCoverage([person('a', at(23), 1440)])

    expect(coverage).toEqual([{ start: at(23), end: 1440, users: ['a'], count: 1 }])
  })

  test('nobody free gives no segments, not an empty one', () => {
    expect(computeCoverage([])).toEqual([])
  })
})

describe('findPlayWindows', () => {
  const roster = ['a', 'b', 'c', 'd', 'e']

  const everyone = (start: number, end: number, who = roster) =>
    who.map((userId) => person(userId, start, end))

  /** The one window a case expects, failing loudly when there is none. */
  const onlyWindow = (coverage: ReturnType<typeof computeCoverage>) => {
    const windows = findPlayWindows(coverage, { roster })
    expect(windows).toHaveLength(1)
    const [window] = windows
    if (!window) throw new Error('expected one play window')
    return window
  }

  test('four available is playable — dropped only below the threshold', () => {
    const coverage = computeCoverage(everyone(at(20), at(23), ['a', 'b', 'c', 'd', 'e']))

    expect(findPlayWindows(coverage, { roster })).toHaveLength(1)
    expect(findPlayWindows(coverage, { roster })[0]).toMatchObject({ count: 5 })
  })

  test('exactly MIN_PLAYABLE is playable; one fewer is not rendered at all', () => {
    expect(MIN_PLAYABLE).toBe(4)

    const justEnough = computeCoverage(everyone(at(20), at(23), ['a', 'b', 'c', 'd']))
    const notEnough = computeCoverage(everyone(at(20), at(23), ['a', 'b', 'c']))

    expect(findPlayWindows(justEnough, { roster })).toHaveLength(1)
    expect(findPlayWindows(notEnough, { roster })).toEqual([])
  })

  test('a window shorter than MIN_SESSION is dropped', () => {
    expect(MIN_SESSION_MINUTES).toBe(60)
    // five people, but free for only half an hour
    const coverage = computeCoverage(everyone(at(20), at(20) + 30))

    expect(findPlayWindows(coverage, { roster })).toEqual([])
  })

  test('a long window is kept whole rather than cut into half-hour cells', () => {
    const coverage = computeCoverage(everyone(at(20), at(23)))

    expect(onlyWindow(coverage)).toMatchObject({ start: at(20), end: at(23), count: 5 })
  })

  test('missing names the roster members who cannot make the whole window', () => {
    const coverage = computeCoverage(everyone(at(20), at(23), ['a', 'b', 'c', 'd']))

    expect(onlyWindow(coverage).missing).toEqual(['e'])
  })

  test('someone free for part of the window is still missing from it', () => {
    // a..d are free the whole time, e only the first half
    const coverage = computeCoverage([
      ...everyone(at(20), at(21.5), ['a', 'b', 'c', 'd']),
      person('e', at(20), at(21)),
    ])

    expect(onlyWindow(coverage)).toMatchObject({ start: at(20), end: at(21.5), missing: ['e'] })
  })

  test('ranked by count, then duration, then start', () => {
    const coverage = computeCoverage([
      // 5 people, 1 hour
      ...everyone(at(9), at(10)),
      // 4 people, 3 hours
      ...everyone(at(14), at(17), ['a', 'b', 'c', 'd']),
      // 5 people, 2 hours
      ...everyone(at(20), at(22)),
    ])

    expect(findPlayWindows(coverage, { roster })).toEqual([
      { start: at(20), end: at(22), count: 5, users: roster, missing: [] },
      { start: at(9), end: at(10), count: 5, users: roster, missing: [] },
      { start: at(14), end: at(17), count: 4, users: ['a', 'b', 'c', 'd'], missing: ['e'] },
    ])
  })

  test('ties resolve by earliest start, so the order is deterministic', () => {
    const coverage = computeCoverage([...everyone(at(18), at(20)), ...everyone(at(9), at(11))])

    expect(findPlayWindows(coverage, { roster }).map((w) => w.start)).toEqual([at(9), at(18)])
  })

  test('an empty roster makes nothing playable rather than everything', () => {
    expect(findPlayWindows(computeCoverage(everyone(at(20), at(23))), { roster: [] })).toEqual([])
  })
})

describe('adding an answer never reduces coverage', () => {
  test('a new answer can only add free minutes', () => {
    const roster = ['a', 'b', 'c', 'd', 'e', 'f']
    const answered = [person('a', at(18), at(21)), person('b', at(20), at(23))]
    const later = [...answered, person('c', at(19), at(22)), person('d', at(23), 1440)]

    const before = computeCoverage(answered)
    const after = computeCoverage(later)

    const countAt = (coverage: ReturnType<typeof computeCoverage>, minute: number) =>
      coverage.find((s) => minute >= s.start && minute < s.end)?.count ?? 0

    for (let minute = 0; minute < 1440; minute++) {
      expect(countAt(after, minute)).toBeGreaterThanOrEqual(countAt(before, minute))
    }

    // and the guarantee the UI relies on: a playable minute stays playable
    const playableBefore = before.filter((s) => s.count >= MIN_PLAYABLE)
    for (const segment of playableBefore) {
      for (let minute = segment.start; minute < segment.end; minute++) {
        expect(countAt(after, minute)).toBeGreaterThanOrEqual(MIN_PLAYABLE)
      }
    }

    expect(roster).toHaveLength(6)
  })
})
