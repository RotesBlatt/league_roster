import { treaty } from '@elysiajs/eden'
import type { App } from '@lol/api'

/**
 * Typed client generated from the Elysia app type. Same origin, so cookies and
 * the dev proxy just work. Route + body changes in the API fail `bun run typecheck` here.
 */
export const api = treaty<App>(window.location.origin).api

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

type EdenResult<T> = { data: T | null; error: unknown; status: number }

function messageOf(error: unknown): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const value = 'value' in error ? error.value : error
    if (value && typeof value === 'object' && 'message' in value) {
      const message = (value as { message?: unknown }).message
      if (typeof message === 'string') return message
    }
  }
  return 'Request failed'
}

/** Eden resolves errors instead of throwing — this turns them into exceptions for React Query. */
export async function unwrap<T>(request: PromiseLike<EdenResult<T>>): Promise<T> {
  const result = await request
  if (result.error) throw new ApiError(result.status, messageOf(result.error))
  return result.data as T
}
