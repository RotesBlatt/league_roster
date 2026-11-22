import { afterEach, expect, test } from 'bun:test'
import { createApi } from '../src/api/client.ts'

/**
 * Eden Treaty turns date-looking JSON *strings* into `Date` objects by default. Our DTOs are
 * explicit about wire types — `profile.birthday` is `YYYY-MM-DD` and every timestamp is epoch ms —
 * so a `Date` arriving where the API declared a string is a lie the form cannot use: the date input
 * goes blank and autosave compares `Date !== string` forever.
 *
 * This pins the client configuration against the real library: the API's JSON must arrive unchanged.
 */
const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('a birthday arrives as the YYYY-MM-DD string the API sent, not a Date', async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        displayName: 'RotesBlatt',
        preferredRole: 'MID',
        birthday: '2004-12-14',
        updatedAt: 0,
      }),
      { status: 200, headers: { 'content-type': 'application/json;charset=utf-8' } },
    )) as unknown as typeof fetch

  const api = createApi('http://localhost:5173')
  const result = await api.me.profile.get()

  expect(result.data?.birthday).toBe('2004-12-14')
})
