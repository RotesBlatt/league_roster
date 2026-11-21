import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { teams } from '../../src/db/schema.ts'
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

/**
 * PATCH /api/teams/:slug — the captain's rename (team-rename.md §3). The slug follows the name,
 * so this is also the route that changes the URL the team lives under.
 */

let ctx: TestContext
let server: TestServer
let call: TestServer['call']

beforeAll(async () => {
  ctx = await createTestContext()
  server = createTestApp(ctx)
  call = server.call
})

afterAll(async () => {
  server.close()
  await ctx.drop()
})

/** A team with a captain, a plain member, and the captain of a *different* team. */
async function scaffold() {
  const founder = await createUser(ctx, { name: 'Founder' })
  const captain = await createUser(ctx, { name: 'Captain' })
  const member = await createUser(ctx, { name: 'Member' })
  const rivalCaptain = await createUser(ctx, { name: 'RivalCaptain' })

  const teamId = await seedTeam(ctx, {
    createdBy: founder,
    name: 'Alte Garde',
    shortName: 'AG',
    slug: `alte-garde-${crypto.randomUUID().slice(0, 8)}`,
  })
  await addMembership(ctx, { teamId, userId: captain, role: 'captain' })
  await addMembership(ctx, { teamId, userId: member, role: 'member' })

  const other = await seedTeam(ctx, {
    createdBy: founder,
    name: 'Andere',
    slug: `andere-${crypto.randomUUID().slice(0, 8)}`,
  })
  await addMembership(ctx, { teamId: other, userId: rivalCaptain, role: 'captain' })

  const [row] = await ctx.db.select().from(teams).where(eq(teams.id, teamId))
  if (!row) throw new Error('seed failed')

  return {
    teamId,
    slug: row.slug,
    captainCookie: await createSessionCookie(ctx, captain),
    memberCookie: await createSessionCookie(ctx, member),
    rivalCaptainCookie: await createSessionCookie(ctx, rivalCaptain),
  }
}

const rename = (slug: string, body: unknown, cookie?: string) =>
  call(`/api/teams/${slug}`, { method: 'PATCH', body, cookie })

describe('PATCH /api/teams/:slug', () => {
  test('an anonymous request is a 401', async () => {
    const { slug } = await scaffold()
    expect((await rename(slug, { name: 'Neu' })).status).toBe(401)
  })

  // the canonical tenant-isolation case: a captain elsewhere must not rename this team, and the
  // answer must not even confirm that the team exists
  test('a captain of another team gets the same 404 as a team that does not exist', async () => {
    const { slug, rivalCaptainCookie } = await scaffold()

    const foreign = await rename(slug, { name: 'Gekapert' }, rivalCaptainCookie)
    const unknown = await rename('no-such-team', { name: 'Gekapert' }, rivalCaptainCookie)

    expect(foreign.status).toBe(404)
    expect(await foreign.json()).toEqual(await unknown.json())
  })

  test('a plain member is a 403, and nothing changes', async () => {
    const { teamId, slug, memberCookie } = await scaffold()

    expect((await rename(slug, { name: 'Von Member' }, memberCookie)).status).toBe(403)

    const [row] = await ctx.db.select().from(teams).where(eq(teams.id, teamId))
    expect(row).toMatchObject({ name: 'Alte Garde', shortName: 'AG' })
  })

  test('a captain renames the team, and the team is reachable under the new slug', async () => {
    const { teamId, slug, captainCookie } = await scaffold()
    const newSlug = `neue-welle-${crypto.randomUUID().slice(0, 8)}`

    const res = await rename(
      slug,
      { name: `Neue Welle ${newSlug.slice(-8)}`, shortName: 'NW' },
      captainCookie,
    )
    expect(res.status).toBe(200)

    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      id: teamId,
      slug: newSlug,
      name: `Neue Welle ${newSlug.slice(-8)}`,
      shortName: 'NW',
    })

    // the answer is what the SPA navigates with: the new slug actually routes
    expect((await call(`/api/teams/${newSlug}/roster`, { cookie: captainCookie })).status).toBe(200)
    expect((await call(`/api/teams/${slug}/roster`, { cookie: captainCookie })).status).toBe(404)

    // and the switcher lists it under the new name
    const listed = (await (await call('/api/teams', { cookie: captainCookie })).json()) as Array<{
      slug: string
      name: string
    }>
    expect(listed.find((team) => team.slug === newSlug)?.name).toBe(
      `Neue Welle ${newSlug.slice(-8)}`,
    )
  })

  test('a rename without a short name keeps the existing one', async () => {
    const { teamId, slug, captainCookie } = await scaffold()

    const res = await rename(
      slug,
      { name: `Ohne Tag ${crypto.randomUUID().slice(0, 8)}` },
      captainCookie,
    )
    expect(res.status).toBe(200)
    expect(((await res.json()) as { shortName: string | null }).shortName).toBe('AG')

    const [row] = await ctx.db.select().from(teams).where(eq(teams.id, teamId))
    expect(row?.shortName).toBe('AG')
  })

  test('a name another team already owns is a 409, and this team keeps its slug', async () => {
    const { teamId, slug, captainCookie } = await scaffold()
    const owner = await createUser(ctx)
    const taken = await seedTeam(ctx, { createdBy: owner, name: 'Belegt', slug: 'belegt' })

    expect((await rename(slug, { name: 'belegt!!' }, captainCookie)).status).toBe(409)

    const [row] = await ctx.db.select().from(teams).where(eq(teams.id, teamId))
    expect(row).toMatchObject({ name: 'Alte Garde', slug })
    expect(taken).not.toBe(teamId)
  })

  test('an unusable or reserved name is a 422', async () => {
    const { slug, captainCookie } = await scaffold()

    expect((await rename(slug, { name: '!!!' }, captainCookie)).status).toBe(422)
    expect((await rename(slug, { name: 'Admin' }, captainCookie)).status).toBe(422)
  })
})
