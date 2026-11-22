import { describe, expect, test } from 'bun:test'
import { canEditAvailability } from '../../src/planner/access.ts'
import {
  addDays,
  MAX_SKIP_WEEKS,
  moveFloor,
  resolveWindowStart,
  splitAnswers,
  startOfWeek,
  todayInZone,
} from '../../src/planner/week.ts'

/**
 * The window is a pure function of the calendar, so it is tested without a database, without a
 * team and without a clock: an instant and a zone go in, a Monday comes out.
 *
 * Fixed dates (all 2026): 11-23 is a Monday, 11-25 a Wednesday, 11-29 a Sunday, 11-30 a Monday;
 * the DST switch is 10-25 (Sunday), so 10-26 and 11-02 are Mondays.
 */

const BERLIN = 'Europe/Berlin'
const at = (iso: string) => new Date(iso)

describe('calendar arithmetic', () => {
  test('addDays counts calendar days, not 24-hour blocks — across the DST switch', () => {
    expect(addDays('2026-10-25', 7)).toBe('2026-11-01')
    expect(addDays('2026-12-27', 7)).toBe('2027-01-03')
    expect(addDays('2026-11-23', -7)).toBe('2026-11-16')
    expect(addDays('2026-11-23', 0)).toBe('2026-11-23')
  })

  test('startOfWeek is the Monday of that week, and Sunday belongs to the week before', () => {
    expect(startOfWeek('2026-11-23')).toBe('2026-11-23')
    expect(startOfWeek('2026-11-25')).toBe('2026-11-23')
    expect(startOfWeek('2026-11-29')).toBe('2026-11-23')
    expect(startOfWeek('2026-11-02')).toBe('2026-11-02')
  })
})

describe('todayInZone', () => {
  test('the same instant is two different days in two zones', () => {
    const instant = at('2026-11-22T23:30:00Z')

    expect(todayInZone(instant, BERLIN)).toBe('2026-11-23')
    expect(todayInZone(instant, 'America/New_York')).toBe('2026-11-22')
  })

  test('a timezone the runtime does not know is a loud failure, not a silent UTC guess', () => {
    expect(() => todayInZone(at('2026-11-22T23:30:00Z'), 'Mars/Olympus')).toThrow()
  })
})

describe('resolveWindowStart', () => {
  const wednesday = at('2026-11-25T12:00:00Z')

  test('no skip shows this week', () => {
    expect(resolveWindowStart(wednesday, { floor: null, timezone: BERLIN })).toBe('2026-11-23')
  })

  test('a floor in the future wins', () => {
    expect(resolveWindowStart(wednesday, { floor: '2026-11-30', timezone: BERLIN })).toBe(
      '2026-11-30',
    )
  })

  test('a stale floor is overtaken by the calendar — self-healing, no reset job', () => {
    expect(resolveWindowStart(wednesday, { floor: '2026-11-02', timezone: BERLIN })).toBe(
      '2026-11-23',
    )
  })

  test('a floor that is not a Monday is normalised to its week', () => {
    // 2026-12-02 is a Wednesday; the week it starts is 2026-11-30
    expect(resolveWindowStart(wednesday, { floor: '2026-12-02', timezone: BERLIN })).toBe(
      '2026-11-30',
    )
  })

  test('a non-Monday floor in the past is still just this week', () => {
    expect(resolveWindowStart(wednesday, { floor: '2026-11-18', timezone: BERLIN })).toBe(
      '2026-11-23',
    )
  })

  test('Sunday 23:59 team time is still this week; Monday 00:30 is the next one', () => {
    const sundayNight = at('2026-11-29T22:59:00Z') // 23:59 Berlin
    const mondayNight = at('2026-11-29T23:30:00Z') // 00:30 Berlin, Monday

    expect(resolveWindowStart(sundayNight, { floor: null, timezone: BERLIN })).toBe('2026-11-23')
    expect(resolveWindowStart(mondayNight, { floor: null, timezone: BERLIN })).toBe('2026-11-30')
  })
})

describe('moveFloor — the captain skipping ahead and back', () => {
  const wednesday = at('2026-11-25T12:00:00Z')
  const move = (floor: string | null, weeks: number) =>
    moveFloor(wednesday, { floor, weeks, timezone: BERLIN })

  test('skip one week moves from the effective start, not from today', () => {
    expect(move(null, 1)).toEqual({ floor: '2026-11-30', applied: true })
    expect(move('2026-11-30', 1)).toEqual({ floor: '2026-12-07', applied: true })
  })

  test('back one week returns to this week and clears the floor', () => {
    expect(move('2026-11-30', -1)).toEqual({ floor: null, applied: true })
    expect(move('2026-12-07', -1)).toEqual({ floor: '2026-11-30', applied: true })
  })

  test('there is nothing behind this week: a stale floor goes back to today, not further', () => {
    expect(move('2026-11-02', -1)).toEqual({ floor: null, applied: true })
    expect(move(null, -1)).toEqual({ floor: null, applied: false })
  })

  test('the cap is real: an eighth week ahead is allowed, a ninth is refused', () => {
    expect(MAX_SKIP_WEEKS).toBe(8)

    // this week is 11-23, so the cap is 11-23 + 8 weeks = 2027-01-18
    expect(move('2027-01-11', 1)).toEqual({ floor: '2027-01-18', applied: true })
    expect(move('2027-01-18', 1)).toEqual({ floor: '2027-01-18', applied: false })
  })
})

describe('splitAnswers', () => {
  test('the roster decides who is missing, not the answer rows', () => {
    const split = splitAnswers(['a', 'b', 'c'], ['c', 'a'])

    expect(split.answered).toEqual(['a', 'c'])
    expect(split.unanswered).toEqual(['b'])
  })

  test('somebody who answered "nothing free" counts as answered', () => {
    expect(splitAnswers(['a', 'b'], ['b'])).toEqual({ answered: ['b'], unanswered: ['a'] })
  })

  test('answers from people who left the team are not reported as answers', () => {
    expect(splitAnswers(['a'], ['a', 'gone'])).toEqual({ answered: ['a'], unanswered: [] })
  })

  test('nobody on the roster means nobody missing', () => {
    expect(splitAnswers([], [])).toEqual({ answered: [], unanswered: [] })
  })
})

describe('canEditAvailability', () => {
  test('your own availability is yours to write', () => {
    expect(canEditAvailability({ id: 'anna' }, 'anna')).toBe(true)
  })

  test('a captain is not a superuser over other people’s weeks', () => {
    expect(canEditAvailability({ id: 'captain' }, 'anna')).toBe(false)
  })

  test('a signed-out caller can write nothing', () => {
    expect(canEditAvailability(null, 'anna')).toBe(false)
  })
})
