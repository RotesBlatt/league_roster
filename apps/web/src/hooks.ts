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

export function usePlayers() {
  return useQuery({ queryKey: ['players'], queryFn: () => unwrap(api.players.get()) })
}

export function useInvites(enabled = true) {
  return useQuery({
    queryKey: ['invites'],
    queryFn: () => unwrap(api.invites.get()),
    enabled,
  })
}

export function useMembers(enabled = true) {
  return useQuery({
    queryKey: ['members'],
    queryFn: () => unwrap(api.members.get()),
    enabled,
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
