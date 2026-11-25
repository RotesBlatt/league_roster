import type {
  ChampionCacheState,
  Division,
  MemberStatus,
  PlayWindow,
  PoolLists,
  Role,
  Tier,
  UserRole,
} from '@lol/shared'

export type Me = {
  id: string
  name: string
  email: string
  image: string | null
  /** null until the account belongs to a team; role/status come from that membership. */
  teamId: string | null
  /** how the SPA addresses that team: /t/<teamSlug>/roster */
  teamSlug: string | null
  role: UserRole
  /** null: no membership at all. 'disabled': this team disabled the account. */
  status: MemberStatus | null
}

/**
 * One row of a team's roster: the captain's entry joined with what the player owns.
 * Rendered straight from the join, so a profile edit shows up without a sync step.
 */
export type RosterEntryDto = {
  id: string
  userId: string
  /** The profile name, or the Discord name while no profile exists. */
  displayName: string
  /** Captain's override, else the player's preference, else null (shown as unassigned). */
  role: Role | null
  note: string | null
  isActive: boolean
  /**
   * The account this team uses: the captain's choice for this entry, else the player's main,
   * else null. `main` says whether it happens to be his main account.
   */
  account: {
    id: string
    gameName: string
    tagLine: string
    verifiedAt: number | null
    isMain: boolean
    /** The ranks of the account this team uses; absent until a save resolved it. */
    ranks: { solo: RiotRankDto | null; flex: RiotRankDto | null }
  } | null
}

/** The player's own profile (`/api/me/profile`). Global: no team is involved. */
export type ProfileDto = {
  displayName: string
  /** Position preference, not the permission — that is `membership.role`. */
  preferredRole: Role
  /** `YYYY-MM-DD`, or null when the player declined to share it. */
  birthday: string | null
  updatedAt: number
}

/**
 * One week of the planner as the page reads it: what everyone said, and what that makes possible.
 *
 * `answered`/`unanswered` come from roster + `answer` rows, never from availability — somebody
 * free nowhere has no intervals and is still answered. `days` is derived on every read (§6), so it
 * cannot go stale the way a stored summary would.
 */
export type PlannerWeekDto = {
  /** Monday, `YYYY-MM-DD`. */
  startsOn: string
  /** Captain opened this (finished) week for writing; visibility is unaffected. */
  unlocked: boolean
  /** Captain said there is nothing to plan here; availability and windows are unaffected. */
  noPractice: boolean
  answered: string[]
  unanswered: string[]
  availability: {
    userId: string
    dayOfWeek: number
    startMinute: number
    endMinute: number
  }[]
  /** Always seven entries, Monday first — "nobody free" is an empty list, not a missing day. */
  days: { dayOfWeek: number; windows: PlayWindow[] }[]
}

/**
 * A member's standing times (`availability_template`) in the same shape the grid paints.
 *
 * Always seven days. This is *not* an answer about any week: the client uses it to prefill a week
 * the member has not answered yet, and the save that follows is the statement (§4b).
 */
export type PlannerTemplateDto = {
  days: { dayOfWeek: number; intervals: { start: number; end: number }[] }[]
}

/** The two visible weeks, plus what they are relative to. */
export type PlannerDto = {
  /** IANA zone every time in here is expressed in — the team's, not the reader's. */
  timezone: string
  /** The team's wall-clock date the window was derived from (`YYYY-MM-DD`). */
  today: string
  /** Monday of the first visible week. */
  windowStart: string
  /**
   * Earliest Monday with a `week` row for this team, or null when nothing has ever been written.
   * The archive lists back to here and no further — the range comes from data, not a page size.
   */
  historyStart: string | null
  /** Active members, in join order: the authority for "who has not answered". */
  roster: string[]
  weeks: PlannerWeekDto[]
}

/** A stored rank: a tier, and a division only below Master. */
export type RiotRankDto = {
  tier: Tier
  /** null for Master, Grandmaster and Challenger — those tiers have no divisions. */
  division: Division | null
}

/** One of the player's League accounts (`/api/me/riot-accounts`). */
export type RiotAccountDto = {
  id: string
  /** Together with `tagLine` this is the label the player recognises: `gameName#tagLine`. */
  gameName: string
  tagLine: string
  /** Platform code, e.g. `euw1`; the regional host is derived from it, never stored. */
  platform: string
  /** At most one per player, enforced by a partial unique index. */
  isMain: boolean
  /** null = typed in but never *verified* against Riot; shown as "unverified", not as an error. */
  verifiedAt: number | null
  /** When the snapshot below was fetched; null = no lookup ever got data here. */
  fetchedAt: number | null
  summonerLevel: number | null
  profileIconId: number | null
  /** Both queues, independently absent: solo-only is the common case. */
  ranks: { solo: RiotRankDto | null; flex: RiotRankDto | null }
}

export type InviteDto = {
  id: string
  code: string
  note: string | null
  maxUses: number
  uses: number
  expiresAt: number | null
  revokedAt: number | null
  createdAt: number
  createdByName: string | null
  /** ready-to-copy path, e.g. /join/ab12cd34 */
  path: string
}

/** A team's own editable identity: the answer to `PATCH /api/teams/:slug`. */
export type TeamDto = {
  id: string
  /** derived from `name`, so a rename usually returns a different one */
  slug: string
  name: string
  shortName: string | null
}

/** One row of the team switcher: `GET /api/teams` — the teams the caller may act as. */
export type TeamSummary = {
  id: string
  slug: string
  name: string
  shortName: string | null
  role: UserRole
}

export type MemberDto = {
  id: string
  name: string
  email: string
  image: string | null
  role: UserRole
  status: MemberStatus
  createdAt: number
  /** Whether this member is on the team's roster (a `roster_entry` exists for them). */
  hasRosterEntry: boolean
  /** His accounts, main first — what the captain picks from when adding him to the roster. */
  accounts: { id: string; gameName: string; tagLine: string; isMain: boolean }[]
  teamId: string | null
}

/**
 * One champion as the SPA renders it: an id and its label (hexserve-champion-data.md §4, §6).
 *
 * Deliberately **not** per patch: the endpoint resolves the newest retained label server-side, so a
 * client cannot show a different name for the same champion depending on which game it is in.
 */
export type ChampionLabelDto = {
  championId: number
  name: string
  slug: string
  /** CommunityDragon URL, stored as the dump gives it. */
  iconUrl: string
  /** Hints only — never a filter, never a warning colour. */
  positions: string[]
  roles: string[]
}

/**
 * `GET /api/champions` — the champion cache as one payload.
 *
 * `state` is computed from what the dump said on this request, so `previous` is honest: we hold
 * rows, just not the newest patch. `patchPublishedAt` and `fetchedAt` are epoch ms and are what the
 * shell shows; both survive a dump outage because they are stored with the rows.
 */
export type ChampionsDto = {
  patch: string | null
  previousPatch: string | null
  patchPublishedAt: number | null
  fetchedAt: number | null
  state: ChampionCacheState
  champions: ChampionLabelDto[]
}

/**
 * One person's column on the pool page (champion-pools.md §7) — their three ordered lists.
 *
 * `version` is `0` and `updatedAt` is `null` for a player who never saved, so the page can show
 * "noch kein Pool" and the first write can send the version straight back without a special case.
 * `updatedAt` is epoch ms; a pool that was cleared still carries both, because "I emptied it on
 * Tuesday" is information and `max(entry.updatedAt)` would have forgotten it.
 */
export type PoolPersonDto = {
  userId: string
  displayName: string
  role: Role | null
  isActive: boolean
  version: number
  updatedAt: number | null
  /** Ids only; names and icons are a lookup in the champion cache. */
  lists: PoolLists
}

/**
 * `GET /api/teams/:slug/pools` — the whole team's pools, in roster order.
 *
 * Every roster entry appears, empty or not: reading "who can blind what" must not become "who
 * bothered to fill a pool", and the captain's chase-list line depends on the holes being visible.
 */
export type PoolsDto = {
  people: PoolPersonDto[]
}

export type ApiError = { message: string }
