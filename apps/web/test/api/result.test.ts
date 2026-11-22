import { describe, expect, test } from 'bun:test'
import { ApiError, messageOf, unwrap } from '../../src/api/result.ts'

describe('unwrap', () => {
  test('returns the data on success', async () => {
    await expect(
      unwrap(Promise.resolve({ data: { id: '1' }, error: null, status: 200 })),
    ).resolves.toEqual({ id: '1' })
  })

  test('throws an ApiError carrying the status', async () => {
    const failure = unwrap(
      Promise.resolve({ data: null, error: { value: { message: 'Captain only' } }, status: 403 }),
    )

    await expect(failure).rejects.toBeInstanceOf(ApiError)
    await expect(failure).rejects.toMatchObject({ status: 403, message: 'Captain only' })
  })

  test('accepts a plain PromiseLike, not just a Promise', async () => {
    const lazy = Promise.resolve({ data: 42, error: null, status: 200 })
    await expect(unwrap(lazy)).resolves.toBe(42)
  })

  test('handles a string error payload', async () => {
    const failure = unwrap(Promise.resolve({ data: null, error: 'boom', status: 500 }))
    await expect(failure).rejects.toMatchObject({ status: 500, message: 'boom' })
  })
})

describe('messageOf', () => {
  test('reads a plain string error', () => {
    expect(messageOf('boom')).toBe('boom')
  })

  test('reads { message }', () => {
    expect(messageOf({ message: 'nope' })).toBe('nope')
  })

  test('reads eden { value: { message } }', () => {
    expect(messageOf({ value: { message: 'Invalid input' } })).toBe('Invalid input')
  })

  test('falls back for unknown shapes', () => {
    expect(messageOf(null)).toBe('Request failed')
    expect(messageOf({})).toBe('Request failed')
    expect(messageOf({ value: { message: '' } })).toBe('Request failed')
    expect(messageOf(undefined)).toBe('Request failed')
  })
})
