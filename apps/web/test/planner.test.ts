import { describe, expect, test } from 'bun:test'
import type { PlannerTemplateDto, PlannerWeekDto } from '@lol/api/schema-types'
import {
  currentWeekStart,
  dateOfWeekDay,
  flattenWindows,
  initialDays,
  isoWeekNumber,
  isProvisional,
  missingNames,
  provisionalText,
  weekHeading,
  weekRange,
  weekStartsBefore,
} from '../src/planner.ts'

/**
 * The page's view logic, without React: what the grid starts as, what the summary says, and how a
 * week is named. Everything here is a function of the DTOs the API returns, so the page itself
 * only lays things out.
 */

const ME = 'me'
const OTHER = 'other'

const week = (overrides: Partial<PlannerWeekDto> = {}): PlannerWeekDto => ({
  startsOn: '2026-11-23',
  unlocked: false,
  answered: [],
  unanswered: [ME, OTHER],
  availability: [],
  days: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, windows: [] })),
  ...overrides,
})

const template = (days: PlannerTemplateDto['days']): PlannerTemplateDto => ({ days })

const window = (start: number, end: number, count: number, missing: string[] = []) => ({
  start,
  end,
  count,
  users: ['a', 'b'],
  missing,
})

describe('initialDays — what the grid opens with', () => {
  test('a week I have not answered starts from my standing times, unsaved', () => {
    const days = initialDays(
      week(),
      template([{ dayOfWeek: 1, intervals: [{ start: 1200, end: 1380 }] }]),
      ME,
    )

    expect(days[1]).toEqual({ dayOfWeek: 1, intervals: [{ start: 1200, end: 1380 }] })
    expect(days[0]).toEqual({ dayOfWeek: 0, intervals: [] })
  })

  test('a week I have answered opens with my saved rows, not the template', () => {
    const days = initialDays(
      week({
        answered: [ME],
        availability: [{ userId: ME, dayOfWeek: 2, startMinute: 540, endMinute: 720 }],
      }),
      template([{ dayOfWeek: 1, intervals: [{ start: 1200, end: 1380 }] }]),
      ME,
    )

    expect(days[2]).toEqual({ dayOfWeek: 2, intervals: [{ start: 540, end: 720 }] })
    expect(days[1]?.intervals).toEqual([])
  })

  test('"answered nothing" opens empty, even with a standing schedule — the answer wins', () => {
    const days = initialDays(
      week({ answered: [ME] }),
      template([{ dayOfWeek: 1, intervals: [{ start: 1200, end: 1380 }] }]),
      ME,
    )

    expect(days.every((day) => day.intervals.length === 0)).toBe(true)
  })

  test('somebody else’s rows never end up in my grid', () => {
    const days = initialDays(
      week({
        answered: [OTHER],
        availability: [{ userId: OTHER, dayOfWeek: 3, startMinute: 600, endMinute: 720 }],
      }),
      template([]),
      ME,
    )

    expect(days.every((day) => day.intervals.length === 0)).toBe(true)
  })

  test('adjacent saved rows are merged, so the grid shows one block', () => {
    const days = initialDays(
      week({
        answered: [ME],
        availability: [
          { userId: ME, dayOfWeek: 4, startMinute: 540, endMinute: 720 },
          { userId: ME, dayOfWeek: 4, startMinute: 720, endMinute: 900 },
        ],
      }),
      template([]),
      ME,
    )

    expect(days[4]?.intervals).toEqual([{ start: 540, end: 900 }])
  })
})

describe('flattenWindows — the summary, best first', () => {
  test('more people beats a longer session', () => {
    const ranked = flattenWindows(
      week({
        days: [
          { dayOfWeek: 0, windows: [window(540, 900, 4)] },
          { dayOfWeek: 1, windows: [window(1200, 1320, 5)] },
        ],
      }),
    )

    expect(ranked.map((entry) => entry.count)).toEqual([5, 4])
    expect(ranked[0]?.dayOfWeek).toBe(1)
  })

  test('a tie on people and length goes to the earlier evening', () => {
    const ranked = flattenWindows(
      week({
        days: [
          { dayOfWeek: 2, windows: [window(1200, 1320, 5)] },
          { dayOfWeek: 0, windows: [window(1140, 1260, 5)] },
        ],
      }),
    )

    expect(ranked.map((entry) => entry.dayOfWeek)).toEqual([0, 2])
  })

  test('a week with nothing playable flattens to an empty list', () => {
    expect(flattenWindows(week())).toEqual([])
  })
})

describe('who is missing', () => {
  test('names come from the roster, and a missing name is not a crash', () => {
    const names = { [ME]: 'Anna', [OTHER]: 'Ben' }

    expect(missingNames(window(1200, 1380, 4, [OTHER]), names)).toEqual(['Ben'])
    expect(missingNames(window(1200, 1380, 4, ['ghost']), names)).toEqual(['?'])
  })

  test('nobody missing is an empty list, not "everyone"', () => {
    expect(missingNames(window(1200, 1380, 5), { [ME]: 'Anna' })).toEqual([])
  })
})

describe('provisional', () => {
  test('an incomplete week is provisional and says how incomplete', () => {
    const partial = week({ answered: [ME], unanswered: [OTHER] })

    expect(isProvisional(partial)).toBe(true)
    expect(provisionalText(partial)).toBe('1 of 2 answered — these times are provisional')
  })

  test('everybody answered is not provisional, and has nothing to nag about', () => {
    const complete = week({ answered: [ME, OTHER], unanswered: [] })

    expect(isProvisional(complete)).toBe(false)
    expect(provisionalText(complete)).toBeNull()
  })
})

describe('weekRange — from when until when', () => {
  test('inside one month it names the month once', () => {
    expect(weekRange('2026-11-23')).toBe('23–29 Nov')
  })

  test('a week that crosses a month names both', () => {
    expect(weekRange('2026-11-30')).toBe('30 Nov – 6 Dec')
  })

  test('a week that crosses a year carries both years', () => {
    expect(weekRange('2026-12-28')).toBe('28 Dec 2026 – 3 Jan 2027')
  })
})

describe('isoWeekNumber', () => {
  test('the first Monday after a Thursday-new-year is week 2', () => {
    expect(isoWeekNumber('2026-01-05')).toBe(2)
  })

  test('a 53-week year does not wrap early', () => {
    expect(isoWeekNumber('2026-12-28')).toBe(53)
  })

  test('the first Monday of the next year is week 1 again', () => {
    expect(isoWeekNumber('2027-01-04')).toBe(1)
  })
})

describe('weekHeading', () => {
  test('the two visible weeks are named, dated and numbered', () => {
    expect(weekHeading('2026-11-23', '2026-11-23')).toBe('This week · 23–29 Nov · Week 48')
    expect(weekHeading('2026-11-30', '2026-11-23')).toBe('Next week · 30 Nov – 6 Dec · Week 49')
  })

  test('a past week has no relative name, only its dates and number', () => {
    expect(weekHeading('2026-11-16', '2026-11-23')).toBe('16–22 Nov · Week 47')
  })
})

describe('weekStartsBefore — the history list', () => {
  test('lists the weeks before the window, newest first', () => {
    expect(weekStartsBefore('2026-11-23', 3)).toEqual(['2026-11-16', '2026-11-09', '2026-11-02'])
  })

  test('crosses a month and a year without special cases', () => {
    expect(weekStartsBefore('2027-01-04', 2)).toEqual(['2026-12-28', '2026-12-21'])
  })

  test('asking for nothing is an empty list, not the window itself', () => {
    expect(weekStartsBefore('2026-11-23', 0)).toEqual([])
  })
})

describe('dateOfWeekDay — the date above each column', () => {
  test('Monday of the week is the start date, day.month', () => {
    expect(dateOfWeekDay('2026-11-23', 0)).toBe('23.11')
    expect(dateOfWeekDay('2026-11-23', 6)).toBe('29.11')
  })

  test('crossing into the next month does not print 32, and keeps both numbers padded', () => {
    expect(dateOfWeekDay('2026-11-30', 3)).toBe('03.12')
    expect(dateOfWeekDay('2026-12-28', 6)).toBe('03.01')
  })
})

describe('currentWeekStart — which visible week is "now"', () => {
  test('a Wednesday belongs to the Monday before it', () => {
    expect(currentWeekStart('2026-11-25')).toBe('2026-11-23')
  })

  test('a Monday is its own week', () => {
    expect(currentWeekStart('2026-11-23')).toBe('2026-11-23')
  })

  test('a Sunday is still the week that started six days ago', () => {
    expect(currentWeekStart('2026-11-29')).toBe('2026-11-23')
  })
})
