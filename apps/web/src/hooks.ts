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
