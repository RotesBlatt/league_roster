import { championStats, type MatchStatRow, type Role } from '@lol/shared'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/index.ts'
import {
  matches,
  matchParticipants,
  memberships,
  profile,
  rosterEntries,
  user,
} from '../db/schema.ts'
import type { ChampionStatDto, PlayerStatsDto, TeamStatsDto } from '../db/schema.types.ts'
import { loadTeamAccounts, ourRowsCondition } from './match-read.ts'
import { compareRosterOrder } from './roster.ts'

/**
 * The champion stats page's read (match-history.md §8, §9).
 *
 * Same tenancy rule as the games list, through the same helper: `match` has no `teamId`, so this
 * starts from **the team's people and accounts** and joins the games they were in (§5.2). The tabla
 * itself is not computed here — `championStats` in `@lol/shared` does that, which is why the numbers
 * on this page and the ones in any future view cannot disagree (§8.1).
 *
 * No scope argument on purpose: the page shows **all** games. The selector (SoloQ / Flex / …) was
 * dropped by product decision, and a half-applied filter is worse than none (§8.1).
 */
export async function readTeamStats(db: Db, input: { teamId: string }): Promise<TeamStatsDto> {
  const { memberIds, puuids, accounts } = await loadTeamAccounts(db, input.teamId)
  if (memberIds.length === 0) return { players: [] }

  const accountOwner = new Map(accounts.map((account) => [account.puuid, account.userId]))

  const [memberRows, profiles, roster] = await Promise.all([
    db
      .select({ userId: memberships.userId, role: memberships.role, status: memberships.status })
      .from(memberships)
      .where(eq(memberships.teamId, input.teamId)),
    db
      .select({
        userId: profile.userId,
        displayName: profile.displayName,
        preferredRole: profile.preferredRole,
      })
      .from(profile),
    db
      .select({
        userId: rosterEntries.userId,
        roleOverride: rosterEntries.roleOverride,
        isActive: rosterEntries.isActive,
      })
      .from(rosterEntries)
      .where(eq(rosterEntries.teamId, input.teamId)),
  ])

  const userRows = await db.select({ id: user.id, name: user.name }).from(user)
  const names = new Map(userRows.map((row) => [row.id, row.name]))

  // typed `Role`, not `string`: the DTO's union is the same one the column is generated from
  const preferredRoles = new Map<string, Role>()
  for (const row of profiles) {
    names.set(row.userId, row.displayName)
    if (row.preferredRole) preferredRoles.set(row.userId, row.preferredRole)
  }

  const rosterByUser = new Map(roster.map((entry) => [entry.userId, entry]))

  // our participant rows with the match facts `championStats` reads — nothing more (§5.1)
  const rows = await db
    .select({
      userId: matchParticipants.userId,
      puuid: matchParticipants.puuid,
      championId: matchParticipants.championId,
      win: matchParticipants.win,
      gameStartAt: matches.gameStartAt,
      durationSeconds: matches.durationSeconds,
      queueId: matches.queueId,
      gameType: matches.gameType,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matchParticipants.matchId, matches.id))
    .where(ourRowsCondition(memberIds, puuids))

  const statRows: MatchStatRow[] = []
  for (const row of rows) {
    // a Riot row says who by puuid; a hand-entered one says who by userId (§5.8)
    const playerId = row.userId ?? (row.puuid ? (accountOwner.get(row.puuid) ?? null) : null)
    // a row with no champion cannot be counted by champion, and one with nobody cannot be attributed
    if (!playerId || row.championId === null) continue

    statRows.push({
      playerId,
      championId: row.championId,
      win: row.win,
      gameStartAt: row.gameStartAt,
      durationSeconds: row.durationSeconds,
      queueId: row.queueId,
      gameType: row.gameType,
    })
  }

  const championRows = championStats(statRows, { scope: 'all' })
  const championsByPlayer = new Map<string, ChampionStatDto[]>()
  for (const row of championRows) {
    const list = championsByPlayer.get(row.playerId) ?? []
    list.push({
      championId: row.championId,
      games: row.games,
      wins: row.wins,
      losses: row.losses,
      winrate: row.winrate,
      lastPlayedAt: row.lastPlayedAt.toISOString(),
    })
    championsByPlayer.set(row.playerId, list)
  }

  const players: PlayerStatsDto[] = memberRows.map((member) => {
    const champions = championsByPlayer.get(member.userId) ?? []
    // the player's own total is the sum of their champion rows: remakes and undecided games were
    // already dropped by `championStats`, so a second counting rule here would disagree with it
    const games = champions.reduce((sum, champion) => sum + champion.games, 0)
    const wins = champions.reduce((sum, champion) => sum + champion.wins, 0)
    const lastPlayedAt = champions
      .map((champion) => champion.lastPlayedAt)
      // ISO instants compare correctly as strings, and an explicit comparator says so instead of
      // relying on a reader knowing that default sort is lexicographic
      .sort((a, b) => a.localeCompare(b))
      .at(-1)

    const entry = rosterByUser.get(member.userId)
    return {
      userId: member.userId,
      displayName: names.get(member.userId) ?? 'Unknown',
      // the captain's override wins over the player's preference, as everywhere else (§5.4)
      role: entry?.roleOverride ?? preferredRoles.get(member.userId) ?? null,
      isActive: entry?.isActive ?? member.status === 'active',
      games,
      wins,
      losses: games - wins,
      // `null`, never 0%, so the card can render `–` (a 0% from no games is a lie in the other direction)
      winrate: games === 0 ? null : Math.round((wins / games) * 100),
      lastPlayedAt: lastPlayedAt ?? null,
      champions,
    }
  })

  return {
    players: players.sort(
      (a, b) => compareRosterOrder(a, b) || a.displayName.localeCompare(b.displayName),
    ),
  }
}
