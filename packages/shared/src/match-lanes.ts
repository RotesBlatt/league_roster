import type { Role } from './team.ts'

/**
 * The lane derivations (match-history.md §7) — inference, and labelled as such.
 *
 * Nothing in Riot's payload says "this was your lane opponent". The bot lane is the trap that makes
 * this a function instead of a column: there are two opponents down there, which is exactly why the
 * sheet has `Partner`, `Lane-Gegner` **and** `Gegner-Partner` rather than one "enemy" column.
 *
 * The honest limits, stated once here so they are not rediscovered as bugs:
 *
 * - `teamPosition` is what Riot *reported*, not what was played. Role swaps and autofill in Flex
 *   make it approximate, and Riot itself sends `''` when it cannot tell;
 * - roams, lane swaps and jungle invades mean "lane opponent" is a game-length average at best —
 *   good enough for scouting ("he is up against *that* top"), not authoritative;
 * - non-SR queues (ARAM, Arena) have no lanes, so every answer is `null` rather than a guess.
 */

/**
 * Riot's `teamPosition` → our `ROLES`, in **one** place (§5.4). Writing this mapping twice is what
 * `quick-wins.md` B2 warns about: the two copies agree on the day they are written.
 *
 * `null` is a real answer, not a failure — an empty position is what Riot sends for a game it could
 * not classify, and rendering "played, but no role" is better than inventing MIDDLE.
 */
export function roleFromTeamPosition(teamPosition: string | null | undefined): Role | null {
  switch (teamPosition) {
    case 'TOP':
      return 'TOP'
    case 'JUNGLE':
      return 'JGL'
    case 'MIDDLE':
      return 'MID'
    case 'BOTTOM':
      return 'ADC'
    case 'UTILITY':
      return 'SUP'
    default:
      return null
  }
}

/**
 * The inverse, for the **writer** side: a hand-entered row has our `Role` (what a person picked in a
 * form) while the column stores Riot's string — because that is what `assignLanes` matches on and
 * what a Riot row will contain. Kept beside `roleFromTeamPosition` so the two cannot drift; the
 * round-trip test is what keeps them honest.
 */
export function teamPositionFromRole(role: Role): string {
  switch (role) {
    case 'TOP':
      return 'TOP'
    case 'JGL':
      return 'JUNGLE'
    case 'MID':
      return 'MIDDLE'
    case 'ADC':
      return 'BOTTOM'
    case 'SUP':
      return 'UTILITY'
  }
}

/** The one of our participants a row can describe: who, where. Both are nullable by design. */
export type LaneParticipant = {
  /** Riot's puuid, or `null` for an opponent nobody typed in (a manual row, §5.8). */
  puuid: string | null
  /** 100 or 200, Riot's side numbers. */
  side: number
  /** Riot's `participantId`, 1–10 — the only stable ordering inside one match. */
  slot: number
  teamPosition?: string | null
}

/**
 * Who stands where, named by `laneKey(side, slot)` — **not by puuid**.
 *
 * The doc sketched "per puuid", but a hand-entered enemy has no puuid at all (§5.8), and an
 * assignment that named people by puuid would answer `null` for exactly the lanes somebody bothered
 * to type in. `(side, slot)` is unique in the schema and present on every row, so the caller can
 * look the participant up and decide what to render (a name for ours, a champion for theirs).
 */
export type LaneAssignment = {
  /** Same team, the paired lane: only the bot duo has one (`BOTTOM ↔ UTILITY`). */
  partner: string | null
  /** Opposing side, same reported position. */
  laneOpponent: string | null
  /** That opponent's own partner — the second name the bot lane needs. */
  opponentPartner: string | null
}

/**
 * The key an assignment is looked up by: **side and slot, not puuid**.
 *
 * The doc sketched "per puuid", but a puuid is exactly what an unknown opponent does not have, and
 * two such rows would collapse into one key. `(side, slot)` is unique in the schema and present on
 * every row, including the hand-entered ones.
 */
export function laneKey(side: number, slot: number): string {
  return `${side}:${slot}`
}

/** `BOTTOM ↔ UTILITY`; every other position stands alone. */
const PAIRED_LANE: Readonly<Record<string, string>> = {
  BOTTOM: 'UTILITY',
  UTILITY: 'BOTTOM',
}

/**
 * One assignment per participant, every input key present — a caller renders `null` fields, it does
 * not handle a missing map entry as well.
 *
 * The partner is always *same team, paired position*; the opponent is always *other team, same
 * position*; `opponentPartner` mirrors our own partner rule on the enemy side. A solo laner gets
 * `null` for both partner fields, which is the truth: nobody stands beside a top laner for 30 min.
 *
 * Ambiguity (two players reporting `MIDDLE`) resolves to the **lowest slot**, so two renders of the
 * same match cannot disagree.
 */
export function assignLanes(participants: readonly LaneParticipant[]): Map<string, LaneAssignment> {
  const find = (
    side: number,
    position: string,
    exclude?: LaneParticipant,
  ): LaneParticipant | undefined => {
    let found: LaneParticipant | undefined
    for (const candidate of participants) {
      if (candidate === exclude) continue
      if (candidate.side !== side) continue
      if (candidate.teamPosition !== position) continue
      // lowest slot wins, so the answer is stable regardless of input order
      if (!found || candidate.slot < found.slot) found = candidate
    }
    return found
  }

  const assignments = new Map<string, LaneAssignment>()

  for (const participant of participants) {
    const position = participant.teamPosition ?? ''
    const enemySide = participant.side === 100 ? 200 : 100

    const pairedPosition = PAIRED_LANE[position]
    const partnerRow = pairedPosition
      ? find(participant.side, pairedPosition, participant)
      : undefined
    const partner = partnerRow ? laneKey(partnerRow.side, partnerRow.slot) : null

    // an empty or unknown position has no lane to match, so it has no opponent either
    const opponent = position ? find(enemySide, position) : undefined
    const opponentPaired = opponent?.teamPosition ? PAIRED_LANE[opponent.teamPosition] : undefined
    const opponentPartnerRow =
      opponent && opponentPaired ? find(enemySide, opponentPaired, opponent) : undefined
    const opponentPartner = opponentPartnerRow
      ? laneKey(opponentPartnerRow.side, opponentPartnerRow.slot)
      : null

    assignments.set(laneKey(participant.side, participant.slot), {
      partner,
      laneOpponent: opponent ? laneKey(opponent.side, opponent.slot) : null,
      opponentPartner,
    })
  }

  return assignments
}
