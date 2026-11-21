import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  createSessionCookie,
  createTestApp,
  createTestContext,
  createUser,
  type TestContext,
  type TestServer,
} from './helpers.ts'

/**
 * `/api/me/riot-accounts` — a player's League accounts (player-profiles.md §3).
 *
 * The rules that are not obvious CRUD:
 *  - the **first** account becomes main; later ones do not;
 *  - deleting the main **promotes** the oldest remaining account, so "has accounts" never means
 *    "has no main" for the roster join later;
 *  - a duplicate Riot ID is a 409 sentence, not a 500 from the unique index;
 *  - another user's account id answers 404 (never 403 — it must not confirm existence).
 */
let ctx: TestContext
let server: TestServer
let call: TestServer['call']
let cookie: string
let otherCookie: string

type Account = {
  id: string
  gameName: string
  tagLine: string
  isMain: boolean
  verifiedAt: unknown
}

const accounts = async (who = cookie) =>
  (await (await call('/api/me/riot-accounts', { cookie: who })).json()) as Account[]

/** The first account, failing loudly if the fixture is not what the test expects. */
async function firstAccount(who = cookie): Promise<Account> {
  const [first] = await accounts(who)
  if (!first) throw new Error('expected at least one account')
  return first
}

async function twoAccounts(): Promise<[Account, Account]> {
  const [first, second] = await accounts()
  if (!first || !second) throw new Error('expected two accounts')
  return [first, second]
}

const add = (body: unknown, who = cookie) =>
  call('/api/me/riot-accounts', { method: 'POST', body, cookie: who })

const remove = (id: string, who = cookie) =>
  call(`/api/me/riot-accounts/${id}`, { method: 'DELETE', cookie: who })

beforeAll(async () => {
  ctx = await createTestContext()
  server = createTestApp(ctx)
  call = server.call

  cookie = await createSessionCookie(ctx, await createUser(ctx, { name: 'Julius' }))
  otherCookie = await createSessionCookie(ctx, await createUser(ctx, { name: 'Other' }))
})

afterAll(async () => {
  server.close()
  await ctx.drop()
})

describe('GET /api/me/riot-accounts', () => {
  test('is closed to anonymous callers', async () => {
    expect((await call('/api/me/riot-accounts')).status).toBe(401)
  })

  test('is an empty list before anything was added — not a 404', async () => {
    expect(await accounts()).toEqual([])
  })
})

describe('POST /api/me/riot-accounts', () => {
  test('is closed to anonymous callers', async () => {
    expect((await add({ gameName: 'Hide on bush', tagLine: 'EUW' }, '')).status).toBe(401)
  })

  test('the first account becomes main and is stored unverified', async () => {
    const response = await add({ gameName: '  Hide on bush ', tagLine: 'EUW' })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      gameName: 'Hide on bush',
      tagLine: 'EUW',
      isMain: true,
      verifiedAt: null,
    })
  })

  test('a second account is not main', async () => {
    expect((await add({ gameName: 'Smurf', tagLine: 'EUW' })).status).toBe(200)

    expect((await accounts()).map((account) => account.isMain)).toEqual([true, false])
  })

  test('a duplicate Riot ID is a conflict, not a database 500', async () => {
    const response = await add({ gameName: 'Smurf', tagLine: 'EUW' })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ message: expect.stringContaining('already') })
  })

  test('a missing half of the Riot ID is a field error', async () => {
    const response = await add({ gameName: 'Nameless', tagLine: '   ' })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ details: [{ path: 'tagLine' }] })
  })

  test('the same Riot ID may be added by a different player', async () => {
    expect((await add({ gameName: 'Smurf', tagLine: 'EUW' }, otherCookie)).status).toBe(200)
  })

  test('one player’s list contains only their own accounts', async () => {
    expect((await accounts(otherCookie)).map((account) => account.gameName)).toEqual(['Smurf'])
  })
})

describe('PUT /api/me/riot-accounts/:id/main', () => {
  const setMain = (id: string, who = cookie) =>
    call(`/api/me/riot-accounts/${id}/main`, { method: 'PUT', cookie: who })

  test('is closed to anonymous callers', async () => {
    const [, second] = await twoAccounts()
    expect((await setMain(second.id, '')).status).toBe(401)
  })

  test('switching makes the target the one and only main', async () => {
    const [wasMain, target] = await twoAccounts()

    const response = await setMain(target.id)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: target.id, isMain: true })

    const list = await accounts()
    expect(list.filter((account) => account.isMain).map((account) => account.id)).toEqual([
      target.id,
    ])
    // the old main is still there, just no longer main
    expect(list.map((account) => account.id)).toContain(wasMain.id)
  })

  test('switching to the account that is already main is a harmless no-op', async () => {
    const main = await firstAccount()

    expect((await setMain(main.id)).status).toBe(200)
    expect(
      (await accounts()).filter((account) => account.isMain).map((account) => account.id),
    ).toEqual([main.id])
  })

  test('another player’s account cannot be taken over: 404, and their main is untouched', async () => {
    const theirs = (await accounts(otherCookie))[0]
    if (!theirs) throw new Error('expected the other player to have an account')

    expect((await setMain(theirs.id)).status).toBe(404)
    expect((await accounts(otherCookie)).map((account) => account.isMain)).toEqual([true])
  })

  test('an id that never existed answers 404', async () => {
    expect((await setMain(crypto.randomUUID())).status).toBe(404)
  })

  test('switch back, so later tests start from the first account as main', async () => {
    const [currentMain, other] = await twoAccounts()
    expect((await setMain(other.id)).status).toBe(200)
    expect((await accounts())[0]?.id).toBe(other.id)
    expect(currentMain.id).not.toBe(other.id)
  })
})

describe('DELETE /api/me/riot-accounts/:id', () => {
  test('is closed to anonymous callers', async () => {
    expect((await remove((await firstAccount()).id, '')).status).toBe(401)
  })

  test('another player’s account id answers 404, not 403', async () => {
    expect((await remove((await firstAccount()).id, otherCookie)).status).toBe(404)
  })

  test('deleting the main promotes the oldest remaining account', async () => {
    const [main, smurf] = await twoAccounts()

    expect((await remove(main.id)).status).toBe(200)

    const left = await accounts()
    expect(left.map((account) => account.gameName)).toEqual([smurf.gameName])
    expect(left[0]?.isMain).toBe(true)
  })

  test('deleting the last account leaves an empty list, not an error', async () => {
    for (const account of await accounts()) {
      expect((await remove(account.id)).status).toBe(200)
    }

    expect(await accounts()).toEqual([])
  })

  test('an id that never existed answers 404', async () => {
    expect((await remove(crypto.randomUUID())).status).toBe(404)
  })
})
