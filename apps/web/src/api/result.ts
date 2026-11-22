/**
 * Pure helpers around Eden results. No window/document access, so they are unit-testable
 * without a DOM harness.
 */

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export type EdenResult<T> = { data: T | null; error: unknown; status: number }

export function messageOf(error: unknown): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const value = 'value' in error ? error.value : error
    if (value && typeof value === 'object' && 'message' in value) {
      const message = (value as { message?: unknown }).message
      if (typeof message === 'string' && message.length > 0) return message
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
