import { describe, expect, test } from 'bun:test'
import { classifyQueue, isRemake, resolveKind } from '../src/match-stats.ts'

/**
 * "What kind of game was this?" (match-history.md §6, §7, §4.7).
 *
 * Everything here is a pure function over plain values, because this is where the feature can be
 * wrong *quietly*: no exception is thrown when a Flex game lands in the SoloQ winrate, the number
 * just becomes a lie. The four cases the doc insists on are the four groups below — the queue
 * table, the precedence, the practice-code inheritance, and remakes.
 */

describe('classifyQueue', () => {
  test('the ranked queues of our scopes are recognised', () => {
    expect(classifyQueue(420, 'MATCHED_GAME')).toBe('solo')
    expect(classifyQueue(440, 'MATCHED_GAME')).toBe('flex')
    // Ranked 5v5 — the premade-five ladder, which is its own data set and not Flex (see QUEUE_KINDS)
    expect(classifyQueue(710, 'MATCHED_GAME')).toBe('ranked5')
  })

  test('normal draft and normal blind are both "normal"', () => {
    expect(classifyQueue(400, 'MATCHED_GAME')).toBe('normal')
    expect(classifyQueue(430, 'MATCHED_GAME')).toBe('normal')
  })

  test('a custom game is custom, by queue id or by game type', () => {
    expect(classifyQueue(0, 'CUSTOM_GAME')).toBe('custom')
    // Riot has been inconsistent about which of the two carries the information
    expect(classifyQueue(0, 'MATCHED_GAME')).toBe('custom')
    expect(classifyQueue(9999, 'CUSTOM_GAME')).toBe('custom')
  })

  test('it never claims a tournament or a scrim — those are not in Riot’s payload', () => {
    // §6: the label is a membership fact or a human decision, never a queue id. Looping the whole
    // table is the honest way to say "there is no id that produces these two".
    const ids = [0, 400, 420, 430, 440, 450, 480, 490, 700, 710, 720, 1700, 1710, 1900, 99999]
    for (const id of ids) {
      expect(classifyQueue(id, 'MATCHED_GAME')).not.toBe('tournament')
      expect(classifyQueue(id, 'MATCHED_GAME')).not.toBe('scrim')
    }
  })

  test('queues we do not scope are "other", not a crash and not a guess', () => {
    // ARAM and Arena have no lanes at all (§7), Clash is not one of our scopes, 99999 is the
    // future queue Riot has not shipped yet
    expect(classifyQueue(450, 'MATCHED_GAME')).toBe('other')
    expect(classifyQueue(1700, 'MATCHED_GAME')).toBe('other')
    expect(classifyQueue(700, 'MATCHED_GAME')).toBe('other')
    expect(classifyQueue(99999, 'MATCHED_GAME')).toBe('other')
  })

  test('a ranked5 game is not swallowed by flex — they are different ladders', () => {
    // the sheet's TYP selector exists for exactly this: mixing them would be a lie about the winrate
    expect(classifyQueue(710, 'MATCHED_GAME')).not.toBe(classifyQueue(440, 'MATCHED_GAME'))
  })

  test('a missing queue id is "other": a manual row has none to classify', () => {
    expect(classifyQueue(null, null)).toBe('other')
    expect(classifyQueue(undefined, undefined)).toBe('other')
  })
})

describe('resolveKind', () => {
  test('a game on our tournament code is a tournament game, whatever anyone tagged it', () => {
    // the membership fact sits on top: a stray re-tag must not demote a league game (§6)
    expect(
      resolveKind({
        tournamentKind: 'tournament',
        taggedKind: 'scrim',
        queueId: 440,
        gameType: 'MATCHED_GAME',
      }),
    ).toBe('tournament')
  })

  test('a practice code is a scrim without anyone tagging it per game', () => {
    expect(resolveKind({ tournamentKind: 'practice', queueId: 440 })).toBe('scrim')
    expect(resolveKind({ tournamentKind: 'scrim', queueId: 440 })).toBe('scrim')
  })

  test('a human tag beats the queue id', () => {
    expect(resolveKind({ taggedKind: 'custom', queueId: 440 })).toBe('custom')
  })

  test('without a tournament or a tag, Riot’s queue id decides', () => {
    expect(resolveKind({ queueId: 420, gameType: 'MATCHED_GAME' })).toBe('solo')
    expect(resolveKind({ queueId: 440, gameType: 'MATCHED_GAME' })).toBe('flex')
  })

  test('a manual row is whatever a human tagged it, and "other" if nobody did', () => {
    expect(resolveKind({ taggedKind: 'scrim', queueId: null })).toBe('scrim')
    expect(resolveKind({ queueId: null, gameType: null })).toBe('other')
  })

  test('nothing at all is "other" rather than a throw', () => {
    expect(resolveKind({})).toBe('other')
    expect(resolveKind({ tournamentKind: null, taggedKind: null })).toBe('other')
  })

  test('the precedence is exactly tournament → tag → queue → other', () => {
    // one row per step of the chain, each with every *lower* input present and disagreeing
    expect(resolveKind({ tournamentKind: 'tournament', taggedKind: 'custom', queueId: 420 })).toBe(
      'tournament',
    )
    expect(resolveKind({ taggedKind: 'custom', queueId: 420 })).toBe('custom')
    expect(resolveKind({ queueId: 420 })).toBe('solo')
    expect(resolveKind({})).toBe('other')
  })
})

describe('isRemake', () => {
  test('under five minutes is a remake', () => {
    expect(isRemake(299)).toBe(true)
    expect(isRemake(60)).toBe(true)
    expect(isRemake(0)).toBe(true)
  })

  test('five minutes and above is a game', () => {
    expect(isRemake(300)).toBe(false)
    expect(isRemake(2100)).toBe(false)
  })

  test('an unknown duration is not a remake — a manual row cannot be one', () => {
    // the alternative is worse: guessing "remake" would silently drop a real scrim from the stats
    expect(isRemake(null)).toBe(false)
    expect(isRemake(undefined)).toBe(false)
  })
})
