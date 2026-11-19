import type { Me } from '@lol/api/schema-types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, unwrap } from './api.ts'

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => unwrap(api.me.get()),
    retry: false,
    staleTime: 30_000,
  })
}

/** Team-scoped hooks take the slug from the route (/t/:slug/...). */
export function usePlayers(slug: string) {
  return useQuery({
    queryKey: ['players', slug],
    queryFn: () => unwrap(api.teams({ slug }).players.get()),
    enabled: slug.length > 0,
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

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401
}
