import { ROLES, type Role } from '@lol/shared'
import type { RosterEntryDto } from '../db/schema.types.ts'
import { parseRole } from './profile.ts'

/**
 * The roster is a **join**, not a copy (player-profiles.md §2): `roster_entry ⋈ profile ⋈ main
 * account`, plus the user row for a name when somebody has not filled in a profile yet.
 *
 * The join lives here as a plain function so the rules that decide what a row *says* are
 * unit-tested — which side of the split wins for the position, what happens to a member without a
 * profile, and what order the list comes out in. The route only fetches and calls this.
 */

export type RosterSources = {
  entries: {
    id: string
    teamId: string
    userId: string
    accountId: string | null
    note: string | null
    roleOverride: Role | null
    isActive: boolean
  }[]
  profiles: {
    userId: string
    displayName: string
    preferredRole: Role
  }[]
  accounts: {
    id: string
    userId: string
    gameName: string
    tagLine: string
    isMain: boolean
    verifiedAt: Date | null
  }[]
  users: {
    id: string
    name: string
  }[]
}

/** Position order for the table: TOP → SUP, anything unknown after all of them. */
const roleOrder = (role: Role | null): number =>
  role === null ? ROLES.length : ROLES.indexOf(role)

export function composeRoster(sources: RosterSources): RosterEntryDto[] {
  const profiles = new Map(sources.profiles.map((row) => [row.userId, row]))
  const users = new Map(sources.users.map((row) => [row.id, row]))
  const accountsById = new Map(sources.accounts.map((row) => [row.id, row]))
  const mainAccounts = new Map(
    sources.accounts.filter((row) => row.isMain).map((row) => [row.userId, row]),
  )

  return sources.entries
    .map((entry): RosterEntryDto => {
      const profile = profiles.get(entry.userId)
      // the captain's choice for this team wins; his main is only the fallback
      const account =
        (entry.accountId ? accountsById.get(entry.accountId) : undefined) ??
        mainAccounts.get(entry.userId)

      return {
        id: entry.id,
        userId: entry.userId,
        // a member without a profile is still a person on the roster: show the Discord name,
        // never a blank line — the captain has to be able to see who is missing what
        displayName: profile?.displayName ?? users.get(entry.userId)?.name ?? 'Unknown',
        // the captain may override the stated preference; otherwise the player decides
        role: entry.roleOverride ?? profile?.preferredRole ?? null,
        note: entry.note,
        isActive: entry.isActive,
        account: account
          ? {
              id: account.id,
              gameName: account.gameName,
              tagLine: account.tagLine,
              verifiedAt: account.verifiedAt?.getTime() ?? null,
              isMain: account.isMain,
            }
          : null,
      }
    })
    .sort(
      (a, b) =>
        roleOrder(a.role) - roleOrder(b.role) ||
        a.displayName.localeCompare(b.displayName) ||
        a.id.localeCompare(b.id),
    )
}

/** What a captain may change on an entry. `undefined` = "not mentioned", which is not "clear it". */
export type RosterWriteInput = {
  /** which of the player's accounts this team uses; validated against the entry's user */
  accountId?: string | null
  note?: string | null
  /** A role string from the body: `null` clears the override, `undefined` leaves it alone. */
  roleOverride?: string | null
  isActive?: boolean
}

export type RosterWriteValues = {
  accountId?: string | null
  note?: string | null
  roleOverride?: Role | null
  isActive?: boolean
}

export type RosterWriteProblem = { field: 'roleOverride'; message: string }

/**
 * Normalises a captain's write. The three-way distinction is the whole point: an absent field must
 * stay absent (a PATCH that only changes the note must not wipe the override), an explicit `null`
 * is how the override is cleared, and a string must be a role we know.
 */
export function normalizeRosterWrite(input: RosterWriteInput): {
  values: RosterWriteValues
  problems: RosterWriteProblem[]
} {
  const values: RosterWriteValues = {}
  const problems: RosterWriteProblem[] = []

  if (input.accountId !== undefined) values.accountId = input.accountId

  if (input.note !== undefined) {
    const note = (input.note ?? '').trim()
    values.note = note === '' ? null : note
  }

  if (input.roleOverride !== undefined) {
    if (input.roleOverride === null) {
      values.roleOverride = null
    } else {
      const role = parseRole(input.roleOverride)
      if (role === null) problems.push({ field: 'roleOverride', message: 'Unknown role' })
      else values.roleOverride = role
    }
  }

  if (input.isActive !== undefined) values.isActive = input.isActive

  return { values, problems }
}
