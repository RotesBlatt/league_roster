import { type ManualMatch, teamPositionFromRole, validateManualMatch } from '@lol/shared'
import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from '../db/index.ts'
import { matchAnnotations, matches, matchParticipants, memberships } from '../db/schema.ts'

/**
 * Entering a scrim by hand (match-history.md §5.8, §10.14) — the one writer that does not need
 * Riot, and the reason the games list has data before the hourly sync exists.
 *
 * Two rules make this safe to sit inside the same tables the sync will write:
 *
 * 1. **`source = 'manual'` and no `riotMatchId`.** Every future sync filters `WHERE source = 'riot'`,
 *    so a hand-entered row is invisible to it *by construction* rather than by discipline (§5.8).
 * 2. **The signature is the validation.** `validateManualMatch` runs before any query, and the
 *    membership check is a separate refusal — a body naming somebody else's player must not become a
 *    row that credits that person with a game in a team they are not in.
 *
 * The write is one transaction: a match without participants, or participants without their kind,
 * is a half-entered game that would show up in the list as a blank row.
 */

export type CreateManualMatchInput = {
  /** The team whose page this is — what the guard resolved, never the body. */
  teamId: string
  /** The member who typed it; stored so "who may fix this typo?" is answerable (§10.14). */
  createdBy: string
  /** Unvalidated JSON from the client. */
  body: unknown
  /** Injected so "a date in the future" is testable without waiting. */
  now?: Date
}

export type CreateManualMatchResult =
  | { ok: true; matchId: string }
  /** `400` is a malformed body, `422` is a well-formed body that names somebody who is not ours. */
  | { ok: false; status: 400 | 422; message: string }

export async function createManualMatch(
  db: Db,
  input: CreateManualMatchInput,
): Promise<CreateManualMatchResult> {
  const validated = validateManualMatch(input.body, { now: input.now })
  if (!validated.ok) {
    return { ok: false, status: 400, message: validated.errors.join('; ') }
  }
  const entry: ManualMatch = validated.value

  // every named player must be a member of **this** team
  const namedIds = entry.players.map((player) => player.userId)
  const memberRows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.teamId, input.teamId), inArray(memberships.userId, namedIds)))
  const memberSet = new Set(memberRows.map((row) => row.userId))
  if (namedIds.some((userId) => !memberSet.has(userId))) {
    return {
      ok: false,
      status: 422,
      message: 'every player must be a member of this team',
    }
  }

  // --- the enemies, in the slot of the player they face -------------------------------
  // A paired opponent must land on side 200 at the *same slot position* as our player, and carry
  // that player's Riot position: `assignLanes` matches a lane opponent by `teamPosition`, so without
  // the position the form's answer would be stored and the games list would still show `–`.
  const pairedEnemies = entry.players.flatMap((player, index) =>
    player.opponentChampionId === null
      ? []
      : [
          {
            slot: 6 + index,
            championId: player.opponentChampionId,
            teamPosition: player.role ? teamPositionFromRole(player.role) : null,
          },
        ],
  )

  const takenSlots = new Set(pairedEnemies.map((enemy) => enemy.slot))
  const freeSlots = [6, 7, 8, 9, 10].filter((slot) => !takenSlots.has(slot))
  const extraEnemies: { slot: number; championId: number; teamPosition: null }[] = []
  for (const opponent of entry.opponents) {
    const slot = freeSlots[extraEnemies.length]
    if (slot === undefined) {
      // five enemies is a team; a sixth would violate the slot constraint with a database error
      // instead of a sentence somebody can act on
      return { ok: false, status: 422, message: 'a game has at most five enemies' }
    }
    extraEnemies.push({ slot, championId: opponent.championId, teamPosition: null })
  }

  const matchId = crypto.randomUUID()
  const now = input.now ?? new Date()

  await db.transaction(async (tx) => {
    await tx.insert(matches).values({
      id: matchId,
      source: 'manual',
      gameStartAt: entry.playedAt,
      // ownership is answerable, and the row survives the team being deleted (§5.8)
      createdByTeamId: input.teamId,
      createdBy: input.createdBy,
    })

    await tx.insert(matchParticipants).values([
      // ours: a person and a champion, in the slot order the form showed
      ...entry.players.map((player, index) => ({
        id: crypto.randomUUID(),
        matchId,
        side: 100,
        slot: index + 1,
        userId: player.userId,
        // the column stores Riot's string, so `assignLanes` works on a hand-entered game too
        teamPosition: player.role ? teamPositionFromRole(player.role) : null,
        championId: player.championId,
        win: entry.win,
        kills: player.kills,
        deaths: player.deaths,
        assists: player.assists,
      })),
      // theirs: champions only — nobody typed a puuid, and inventing one is the one thing §5.1 forbids
      ...[...pairedEnemies, ...extraEnemies].map((enemy) => ({
        id: crypto.randomUUID(),
        matchId,
        side: 200,
        slot: enemy.slot,
        puuid: null,
        userId: null,
        teamPosition: enemy.teamPosition,
        championId: enemy.championId,
        // the inverse result, so neither side reads as "unknown" on a finished game
        win: !entry.win,
        kills: null,
        deaths: null,
        assists: null,
      })),
    ])

    // the human half: the kind a manual row cannot derive, and the note — `match_annotation`'s
    // first writer (§5.5). Per team, because the note is the team's opinion.
    await tx.insert(matchAnnotations).values({
      matchId,
      teamId: input.teamId,
      taggedKind: entry.kind,
      note: entry.note,
      updatedBy: input.createdBy,
      updatedAt: now,
    })
  })

  return { ok: true, matchId }
}
