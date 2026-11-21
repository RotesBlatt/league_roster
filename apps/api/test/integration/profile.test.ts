import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Fields, Logger } from '../../src/lib/log/logger.ts'
import {
  createSessionCookie,
  createTestApp,
  createTestContext,
  createUser,
  type TestContext,
  type TestServer,
} from './helpers.ts'

/**
 * `/api/me/profile` — the player's own data, global (player-profiles.md §2, §5).
 *
 * The guard is the point: `{ auth: true }`, **not** `teamMember`. A person who has signed in but
 * is not in any team yet must be able to fill this in, or onboarding deadlocks forever.
 */
let ctx: TestContext
let server: TestServer
let call: TestServer['call']
let userId: string
let cookie: string
let otherUserId: string
let otherCookie: string

const events: { event: string; fields?: Fields }[] = []

/** Capture logger: narrow interface, so no pino and no files are involved. */
const logger: Logger = {
  debug: (event, fields) => events.push({ event, fields }),
  info: (event, fields) => events.push({ event, fields }),
  warn: (event, fields) => events.push({ event, fields }),
  error: (event, fields) => events.push({ event, fields }),
  child: () => logger,
}

const valid = { displayName: 'Julius', preferredRole: 'MID', birthday: '2001-07-14' }

beforeAll(async () => {
  ctx = await createTestContext()
  server = createTestApp(ctx, { logger })
  call = server.call

  // neither user has a membership: this is exactly the "signed in, no team" state
  userId = await createUser(ctx, { name: 'Julius' })
  cookie = await createSessionCookie(ctx, userId)
  otherUserId = await createUser(ctx, { name: 'Other' })
  otherCookie = await createSessionCookie(ctx, otherUserId)
})

afterAll(async () => {
  server.close()
  await ctx.drop()
})

const getProfile = (who = cookie) => call('/api/me/profile', { cookie: who })
const putProfile = (body: unknown, who = cookie) =>
  call('/api/me/profile', { method: 'PUT', body, cookie: who })

describe('GET /api/me/profile', () => {
  test('is closed to anonymous callers', async () => {
    expect((await getProfile('')).status).toBe(401)
  })

  test('answers null before anything was saved — "not set up" is not an error', async () => {
    const response = await getProfile()
    expect(response.status).toBe(200)
    expect(await response.json()).toBeNull()
  })
})

describe('PUT /api/me/profile', () => {
  test('is closed to anonymous callers', async () => {
    expect((await putProfile(valid, '')).status).toBe(401)
  })

  test('a user without any team can save a profile', async () => {
    const response = await putProfile(valid)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      displayName: 'Julius',
      preferredRole: 'MID',
      birthday: '2001-07-14',
    })
  })

  test('the saved profile is what GET returns, with a numeric timestamp', async () => {
    const body = (await (await getProfile()).json()) as { updatedAt: number; displayName: string }

    expect(body.displayName).toBe('Julius')
    expect(typeof body.updatedAt).toBe('number')
  })

  test('a second save overwrites the first instead of adding a row', async () => {
    const response = await putProfile({ displayName: '  Julius2  ', preferredRole: 'ADC' })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      displayName: 'Julius2',
      preferredRole: 'ADC',
      // omitting the birthday in a save means "no birthday", not "keep the old one"
      birthday: null,
    })
  })

  test('a birthday can be set and cleared again', async () => {
    await putProfile({ ...valid, birthday: '' })
    expect(((await (await getProfile()).json()) as { birthday: unknown }).birthday).toBeNull()

    await putProfile(valid)
    expect(((await (await getProfile()).json()) as { birthday: unknown }).birthday).toBe(
      '2001-07-14',
    )
  })

  test('a blank display name is refused with a field path', async () => {
    const response = await putProfile({ displayName: '   ', preferredRole: 'MID' })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      details: [{ path: 'displayName' }],
    })
  })

  test('a birthday that is not a real date is refused', async () => {
    const response = await putProfile({ ...valid, birthday: '14.07.2001' })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      details: [{ path: 'birthday' }],
    })
  })

  test('a failed save changes nothing', async () => {
    const before = await (await getProfile()).json()
    expect((await putProfile({ ...valid, displayName: '' })).status).toBe(422)
    expect(await (await getProfile()).json()).toEqual(before as never)
  })

  test('an unknown role is rejected by the schema, not stored', async () => {
    expect((await putProfile({ ...valid, preferredRole: 'JUNGLE' })).status).toBe(422)
  })

  test('extra fields cannot aim the write at another user or grant a role', async () => {
    // Elysia strips unknown keys; the route writes `me.id` and the three normalised fields.
    // So the interesting claim is not "rejected" but "cannot take effect".
    const victimId = await createUser(ctx, { name: 'Victim' })
    const victimCookie = await createSessionCookie(ctx, victimId)

    const response = await putProfile({
      displayName: 'Sneaky',
      preferredRole: 'SUP',
      userId: victimId,
      isCaptain: true,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ displayName: 'Sneaky', preferredRole: 'SUP' })
    // nothing was written under the smuggled id: the victim still has no profile at all
    expect(await (await getProfile(victimCookie)).json()).toBeNull()
  })

  test('one user cannot see or overwrite another user’s profile', async () => {
    expect(await (await getProfile(otherCookie)).json()).toBeNull()

    // read before writing, so this test does not depend on what earlier tests saved
    const mineBefore = ((await (await getProfile(cookie)).json()) as { displayName: string })
      .displayName

    await putProfile({ displayName: 'Other Name', preferredRole: 'TOP' }, otherCookie)

    expect(((await (await getProfile(cookie)).json()) as { displayName: string }).displayName).toBe(
      mineBefore,
    )
    expect(
      ((await (await getProfile(otherCookie)).json()) as { displayName: string }).displayName,
    ).toBe('Other Name')
  })

  test('a successful save is logged with the user, not with the name', () => {
    const saves = events.filter((entry) => entry.event === 'profile.updated')

    expect(saves.map((entry) => entry.fields?.userId)).toContain(otherUserId)
    expect(JSON.stringify(saves.map((entry) => entry.fields))).not.toContain('Other Name')
  })
})
