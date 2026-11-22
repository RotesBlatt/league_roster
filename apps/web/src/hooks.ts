import type { Me, ProfileDto } from '@lol/api/schema-types'
import type { Role } from '@lol/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, unwrap } from './api.ts'
import type { DayIntervals } from './availability-grid.ts'
import type { AccountBody, ProfileBody } from './profile-form.ts'

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => unwrap(api.me.get()),
    retry: false,
    staleTime: 30_000,
  })
}

/** The teams I may act as (`GET /api/teams`) — what the switcher lists. */
export function useMyTeams() {
  return useQuery({
    queryKey: ['teams'],
    queryFn: () => unwrap(api.teams.get()),
    retry: false,
  })
}

export function useInvites(slug: string, enabled = true) {
  return useQuery({
    queryKey: ['invites', slug],
    queryFn: () => unwrap(api.teams({ slug }).invites.get()),
    enabled: enabled && slug.length > 0,
  })
}

export function useMembers(slug: string, enabled = true) {
  return useQuery({
    queryKey: ['members', slug],
    queryFn: () => unwrap(api.teams({ slug }).members.get()),
    enabled: enabled && slug.length > 0,
  })
}

/**
 * `POST /api/teams`. There is no tenant in the URL yet, so this is the one team action that
 * takes no slug. Seeding `['me']` is what turns the app from "no team" into that team
 * without a refetch.
 */
export function useCreateTeam() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; shortName?: string }) => unwrap(api.teams.post(input)),
    onSuccess: (me: Me) => {
      queryClient.setQueryData(['me'], me)
      // a second team has to show up in the switcher without a reload
      void queryClient.invalidateQueries({ queryKey: ['teams'] })
    },
  })
}

export function useRefreshMe() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => unwrap(api.me.get()),
    onSuccess: (me: Me) => queryClient.setQueryData(['me'], me),
  })
}

/** Cache keys in one place, so "what does saving invalidate?" is answerable here. */
export const PROFILE_KEY = ['profile'] as const
export const RIOT_ACCOUNTS_KEY = ['riot-accounts'] as const

/**
 * The player's own profile — global, not team-scoped, like the API route behind it.
 * `null` data is the normal "never set up" answer, not an error.
 */
export function useProfile() {
  return useQuery({
    queryKey: PROFILE_KEY,
    queryFn: () => unwrap(api.me.profile.get()),
    retry: false,
  })
}

/**
 * A save returns the stored row, so it is seeded into the cache instead of invalidated: the form
 * would otherwise refetch exactly the value it just received (and flash while doing it).
 */
export function useSaveProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ProfileBody) => unwrap(api.me.profile.put(body)),
    onSuccess: (profile: ProfileDto) => queryClient.setQueryData(PROFILE_KEY, profile),
  })
}

export function useRiotAccounts() {
  return useQuery({
    queryKey: RIOT_ACCOUNTS_KEY,
    queryFn: () => unwrap(api.me['riot-accounts'].get()),
    retry: false,
  })
}

/**
 * The three account writes invalidate the list rather than patching it: the server decides
 * ordering (main first) and promotion (deleting the main promotes another), and a client-side
 * guess would disagree with it.
 */
export function useAddRiotAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: AccountBody) => unwrap(api.me['riot-accounts'].post(body)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RIOT_ACCOUNTS_KEY }),
  })
}

export function useRemoveRiotAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.me['riot-accounts']({ id }).delete()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RIOT_ACCOUNTS_KEY }),
  })
}

export function useSwitchMainRiotAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.me['riot-accounts']({ id }).main.put()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RIOT_ACCOUNTS_KEY }),
  })
}

export const ROSTER_KEY = ['roster'] as const

/**
 * A team's roster — the join, not a copy. `slug` is in the key because two teams can be open in
 * two tabs, and they are different lists.
 */
export function useRoster(slug: string) {
  return useQuery({
    queryKey: [...ROSTER_KEY, slug],
    queryFn: () => unwrap(api.teams({ slug }).roster.get()),
    enabled: slug.length > 0,
  })
}

export type RosterWrite = {
  /** which of his accounts this team uses; null/absent = follow his main */
  accountId?: string | null
  note?: string | null
  roleOverride?: Role | null
  isActive?: boolean
}

/**
 * Every roster write invalidates the list rather than patching it: the server decides ordering and
 * the join, so a locally guessed row would disagree with what the next render shows.
 */
export function useAddRosterEntry(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { userId: string } & RosterWrite) =>
      unwrap(api.teams({ slug }).roster.post(body)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...ROSTER_KEY, slug] }),
  })
}

export function useUpdateRosterEntry(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & RosterWrite) =>
      unwrap(api.teams({ slug }).roster({ id }).patch(body)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...ROSTER_KEY, slug] }),
  })
}

export function useRemoveRosterEntry(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => unwrap(api.teams({ slug }).roster({ id }).delete()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...ROSTER_KEY, slug] }),
  })
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401
}

export const PLANNER_KEY = ['planner'] as const
export const PLANNER_TEMPLATE_KEY = ['planner-template'] as const

/**
 * The two visible weeks, everyone's answers and the windows they enable. The API derives the
 * window from the team's clock, so this query is always "now" — there is no stored current week
 * to go stale.
 */
export function usePlanner(slug: string) {
  return useQuery({
    queryKey: [...PLANNER_KEY, slug],
    queryFn: () => unwrap(api.teams({ slug }).planner.get()),
    enabled: slug.length > 0,
  })
}

/** The caller's standing times — the same grid shape a week save takes. */
export function usePlannerTemplate(slug: string) {
  return useQuery({
    queryKey: [...PLANNER_TEMPLATE_KEY, slug],
    queryFn: () => unwrap(api.teams({ slug }).planner.template.get()),
    enabled: slug.length > 0,
  })
}

/**
 * Saving a week invalidates the planner rather than patching it: the summary is computed from
 * everyone's rows, so the server's version of "what is playable now" is the only correct one.
 */
export function useSaveWeek(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ startsOn, days }: { startsOn: string; days: DayIntervals[] }) =>
      unwrap(api.teams({ slug }).planner({ startsOn }).put({ days })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...PLANNER_KEY, slug] }),
  })
}

/** A standing schedule is not an answer, so only the template cache has to change. */
export function useSaveTemplate(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (days: DayIntervals[]) =>
      unwrap(api.teams({ slug }).planner.template.put({ days })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...PLANNER_TEMPLATE_KEY, slug] }),
  })
}

/**
 * The captain's window moves. Both invalidate the planner: the window is team state, so the next
 * render has to come from the server rather than from a locally guessed offset.
 */
export function useSkipWindow(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (weeks: 1 | -1) => unwrap(api.teams({ slug }).planner.skip.post({ weeks })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...PLANNER_KEY, slug] }),
  })
}

export function useResetWindow(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => unwrap(api.teams({ slug }).planner.reset.post()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...PLANNER_KEY, slug] }),
  })
}

/** Any week by its Monday — how history is read, and how an opened week is edited (§5). */
export function useWeek(slug: string, startsOn: string | null) {
  return useQuery({
    queryKey: [...PLANNER_KEY, slug, 'week', startsOn],
    queryFn: () =>
      unwrap(
        api
          .teams({ slug })
          .planner({ startsOn: startsOn ?? '' })
          .get(),
      ),
    enabled: slug.length > 0 && startsOn !== null,
  })
}

/** Captain only. Opening a finished week changes writing, never visibility. */
export function useUnlockWeek(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ startsOn, unlocked }: { startsOn: string; unlocked: boolean }) =>
      unwrap(api.teams({ slug }).planner({ startsOn }).unlock.post({ unlocked })),
    onSuccess: (_result, { startsOn }) => {
      void queryClient.invalidateQueries({ queryKey: [...PLANNER_KEY, slug] })
      void queryClient.invalidateQueries({ queryKey: [...PLANNER_KEY, slug, 'week', startsOn] })
    },
  })
}
