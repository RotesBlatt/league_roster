import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { memberships, teams } from '../../src/db/schema.ts'
import { createTeam } from '../../src/lib/teams.ts'
import {
  addMembership,
  createSessionCookie,
  createTestApp,
  createTestContext,
  createUser,
  seedTeam,
  type TestContext,
  type TestServer,
} from './helpers.ts'

let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.drop()
})

describe('team schema', () => {
  test('a team carries an optional short name', async () => {
    const creator = await createUser(ctx)
    const tagged = await seedTeam(ctx, { createdBy: creator, shortName: 'DBW' })
    const untagged = await seedTeam(ctx, { createdBy: creator })

    const [withShort] = await ctx.db.select().from(teams).where(eq(teams.id, tagged))
    const [without] = await ctx.db.select().from(teams).where(eq(teams.id, untagged))

    expect(withShort?.shortName).toBe('DBW')
    expect(without?.shortName).toBeNull()
  })
})

describe('createTeam', () => {
  test('creating a team makes the creator its captain, in one transaction', async () => {
    const creator = await createUser(ctx)
    const result = await createTeam(ctx.db, {
      userId: creator,
      name: 'Die Besten',
      shortName: 'DBW',
    })
    if (!result.ok) throw new Error(result.message)

    expect(result.team).toMatchObject({
      name: 'Die Besten',
      shortName: 'DBW',
      slug: 'die-besten',
      createdBy: creator,
    })
    expect(result.membership).toMatchObject({
      teamId: result.team.id,
      userId: creator,
      role: 'captain',
      status: 'active',
    })

    // the rows exist, not just the returned objects
    const [team] = await ctx.db.select().from(teams).where(eq(teams.id, result.team.id))
    const rows = await ctx.db
      .select()
      .from(memberships)
      .where(eq(memberships.teamId, result.team.id))

    expect(team?.slug).toBe('die-besten')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ userId: creator, role: 'captain', status: 'active' })
  })

  test('the slug is derived from the name, umlauts and all', async () => {
    const creator = await createUser(ctx)
    const result = await createTeam(ctx.db, { userId: creator, name: 'Die Löwen' })
    if (!result.ok) throw new Error(result.message)

    expect(result.team.slug).toBe('die-loewen')
  })

  test('a taken slug is a 409, and nothing is written', async () => {
    const owner = await createUser(ctx)
    const latecomer = await createUser(ctx)
    // its own name: other tests in this file already own "Die Besten"
    const first = await createTeam(ctx.db, { userId: owner, name: 'Taken Name' })
    if (!first.ok) throw new Error(first.message)

    // same slug after slugify, different spelling
    const clash = await createTeam(ctx.db, { userId: latecomer, name: 'taken name!' })

    expect(clash).toMatchObject({ ok: false, status: 409 })
    expect(
      await ctx.db.select().from(memberships).where(eq(memberships.userId, latecomer)),
    ).toEqual([])
  })

  test('a name with no usable characters is a 422, and writes nothing', async () => {
    const creator = await createUser(ctx)

    expect(await createTeam(ctx.db, { userId: creator, name: '!!!' })).toMatchObject({
      ok: false,
      status: 422,
    })
    expect(await ctx.db.select().from(memberships).where(eq(memberships.userId, creator))).toEqual(
      [],
    )
  })

  test('a name that slugifies into a reserved word is a 422', async () => {
    const creator = await createUser(ctx)

    expect(await createTeam(ctx.db, { userId: creator, name: 'Admin' })).toMatchObject({
      ok: false,
      status: 422,
    })
  })

  test('the short name stays optional, trimmed, and short', async () => {
    const creator = await createUser(ctx)

    const blank = await createTeam(ctx.db, { userId: creator, name: 'Ohne Tag', shortName: '   ' })
    if (!blank.ok) throw new Error(blank.message)
    expect(blank.team.shortName).toBeNull()

    const padded = await createTeam(ctx.db, {
      userId: creator,
      name: 'Mit Tag',
      shortName: ' DBW ',
    })
    if (!padded.ok) throw new Error(padded.message)
    expect(padded.team.shortName).toBe('DBW')

    const tooLong = await createTeam(ctx.db, {
      userId: creator,
      name: 'Zu lang',
      shortName: 'DBWDBWDBWDBW',
    })
    expect(tooLong).toMatchObject({ ok: false, status: 422 })
  })
})

describe('POST /api/teams', () => {
  let server: TestServer
  let call: TestServer['call']

  beforeAll(async () => {
    server = createTestApp(ctx)
    call = server.call
    // A team that already has an active captain: the retired bootstrap ("first account
    // becomes captain") only fires when nobody is active, so it stays out of these tests.
    const founder = await createUser(ctx, { name: 'Founder' })
    const seeded = await seedTeam(ctx, { createdBy: founder, name: 'Seeded' })
    await addMembership(ctx, { teamId: seeded, userId: founder, role: 'captain' })
  })

  afterAll(() => {
    server.close()
  })

  test('an anonymous request is a 401', async () => {
    const res = await call('/api/teams', { method: 'POST', body: { name: 'Anon' } })
    expect(res.status).toBe(401)
  })

  test('the creator becomes captain, and can immediately open the roster', async () => {
    const creator = await createUser(ctx, { name: 'Gruender' })
    const cookie = await createSessionCookie(ctx, creator)

    const res = await call('/api/teams', {
      cookie,
      method: 'POST',
      body: { name: 'Grüne Hölle', shortName: 'GH' },
    })
    expect(res.status).toBe(200)

    // the response is `Me` for the new team, so the SPA can navigate without a second call
    const me = (await res.json()) as { teamSlug: string | null; role: string; status: string }
    expect(me).toMatchObject({ teamSlug: 'gruene-hoelle', role: 'captain', status: 'active' })

    const roster = await call('/api/teams/gruene-hoelle/players', { cookie })
    expect(roster.status).toBe(200)
    expect(await roster.json()).toEqual([])
  })

  test('two accounts create two teams that never see each other', async () => {
    const alice = await createUser(ctx, { name: 'Alice' })
    const bob = await createUser(ctx, { name: 'Bob' })
    const aliceCookie = await createSessionCookie(ctx, alice)
    const bobCookie = await createSessionCookie(ctx, bob)

    const aliceTeam = await call('/api/teams', {
      cookie: aliceCookie,
      method: 'POST',
      body: { name: 'Alice Ascending' },
    })
    const bobTeam = await call('/api/teams', {
      cookie: bobCookie,
      method: 'POST',
      body: { name: 'Bob Battalion' },
    })
    expect(aliceTeam.status).toBe(200)
    expect(bobTeam.status).toBe(200)

    expect(
      await (await call('/api/teams/alice-ascending/players', { cookie: aliceCookie })).json(),
    ).toEqual([])
    // the other team's slug answers like one that does not exist
    const foreign = await call('/api/teams/bob-battalion/players', { cookie: aliceCookie })
    const unknown = await call('/api/teams/no-such-team/players', { cookie: aliceCookie })
    expect(foreign.status).toBe(404)
    expect(await foreign.json()).toEqual(await unknown.json())
  })

  test('a name whose slug is taken is a 409, and the account stays team-less', async () => {
    const first = await createUser(ctx)
    const second = await createUser(ctx)
    const firstCookie = await createSessionCookie(ctx, first)
    const secondCookie = await createSessionCookie(ctx, second)

    const created = await call('/api/teams', {
      cookie: firstCookie,
      method: 'POST',
      body: { name: 'Doppelt Gemoppelt' },
    })
    expect(created.status).toBe(200)

    const clash = await call('/api/teams', {
      cookie: secondCookie,
      method: 'POST',
      body: { name: 'doppelt  gemoppelt!!' },
    })
    expect(clash.status).toBe(409)

    const me = (await (await call('/api/me', { cookie: secondCookie })).json()) as {
      teamSlug: string | null
      status: string | null
    }
    expect(me).toMatchObject({ teamSlug: null, status: null })
  })

  test('an unusable or reserved name, or an over-long short name, is a 422', async () => {
    const creator = await createUser(ctx)
    const cookie = await createSessionCookie(ctx, creator)

    const unusable = await call('/api/teams', { cookie, method: 'POST', body: { name: '!!!' } })
    expect(unusable.status).toBe(422)

    const reserved = await call('/api/teams', { cookie, method: 'POST', body: { name: 'Admin' } })
    expect(reserved.status).toBe(422)

    const longTag = await call('/api/teams', {
      cookie,
      method: 'POST',
      body: { name: 'Langer Tag', shortName: 'DBWDBWDBWDBW' },
    })
    expect(longTag.status).toBe(422)
  })
})

describe('GET /api/teams', () => {
  let server: TestServer
  let call: TestServer['call']

  beforeAll(() => {
    server = createTestApp(ctx)
    call = server.call
  })

  afterAll(() => {
    server.close()
  })

  test('an anonymous request is a 401', async () => {
    expect((await call('/api/teams')).status).toBe(401)
  })

  test('lists exactly the teams I am an active member of', async () => {
    const owner = await createUser(ctx, { name: 'Owner' })
    const mine = await createUser(ctx, { name: 'Mine' })

    const captain = await seedTeam(ctx, {
      createdBy: owner,
      slug: 'gamma',
      name: 'Gamma',
      shortName: 'GM',
    })
    const member = await seedTeam(ctx, { createdBy: owner, slug: 'delta', name: 'Delta' })
    // exist, but not for me: neither may appear
    await seedTeam(ctx, { createdBy: owner, slug: 'secret', name: 'Secret' })
    const suspended = await seedTeam(ctx, {
      createdBy: owner,
      slug: 'suspended',
      name: 'Suspended',
    })

    await addMembership(ctx, { teamId: captain, userId: mine, role: 'captain' })
    await addMembership(ctx, { teamId: member, userId: mine, role: 'member' })
    await addMembership(ctx, { teamId: suspended, userId: mine, status: 'disabled' })

    const cookie = await createSessionCookie(ctx, mine)
    const res = await call('/api/teams', { cookie })
    expect(res.status).toBe(200)

    // alphabetical by slug, so the switcher has a stable order
    expect(await res.json()).toEqual([
      { id: member, slug: 'delta', name: 'Delta', shortName: null, role: 'member' },
      { id: captain, slug: 'gamma', name: 'Gamma', shortName: 'GM', role: 'captain' },
    ])
  })

  test('an account in no team gets an empty list', async () => {
    const loner = await createUser(ctx, { name: 'Loner' })
    const cookie = await createSessionCookie(ctx, loner)

    const res = await call('/api/teams', { cookie })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })
})
