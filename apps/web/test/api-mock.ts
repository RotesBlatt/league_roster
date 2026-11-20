import { mock } from 'bun:test'
import { ApiError, unwrap } from '../src/api-result.ts'

/**
 * One `api.ts` mock for every UI test, because `mock.module` is **process-wide** in bun:
 * whoever registered last wins, so two files each bringing their own factory silently break
 * each other (this happened twice — once on `hooks.ts`, once on `TeamSwitcher.tsx`).
 *
 * The state lives here, in a module both files import, so whichever factory happens to be
 * active reads the same object. Tests set it in `beforeEach`.
 */

export type Result = { data: unknown; error: unknown; status: number }

export const apiState: {
  /** GET /api/me */
  me: Result
  /** GET /api/teams/:slug/invites */
  inviteList: Result
  /** GET /api/teams/:slug/members */
  memberList: Result
  /** GET /api/teams — the switcher's list */
  teamList: Result
  /** POST /api/teams */
  createTeam: Result
  /** PATCH /api/teams/:slug */
  renameTeam: Result
  /** the body handed to POST /api/teams, for assertions */
  sentBody: unknown
  /** the body handed to PATCH /api/teams/:slug, for assertions */
  sentRename: unknown
} = {
  me: { data: null, error: null, status: 200 },
  inviteList: { data: [], error: null, status: 200 },
  memberList: { data: [], error: null, status: 200 },
  teamList: { data: [], error: null, status: 200 },
  createTeam: { data: null, error: null, status: 200 },
  renameTeam: { data: null, error: null, status: 200 },
  sentBody: undefined,
  sentRename: undefined,
}

export function resetApiState() {
  apiState.me = { data: null, error: null, status: 200 }
  apiState.inviteList = { data: [], error: null, status: 200 }
  apiState.memberList = { data: [], error: null, status: 200 }
  apiState.teamList = { data: [], error: null, status: 200 }
  apiState.createTeam = { data: null, error: null, status: 200 }
  apiState.renameTeam = { data: null, error: null, status: 200 }
  apiState.sentBody = undefined
  apiState.sentRename = undefined
}

/** Call once per test file, before importing the components under test. */
export function installApiMock() {
  mock.module('../src/api.ts', () => ({
    ApiError,
    unwrap,
    api: {
      me: {
        get: () => Promise.resolve(apiState.me),
      },
      // Eden's `teams` is callable (it takes the path params) *and* carries the collection
      // verbs, so the mock has to be both, or one surface silently stops working
      teams: Object.assign(
        (params: { slug: string }) => ({
          patch: (body: unknown) => {
            apiState.sentRename = { slug: params.slug, body }
            return Promise.resolve(apiState.renameTeam)
          },
          invites: { get: () => Promise.resolve(apiState.inviteList) },
          members: { get: () => Promise.resolve(apiState.memberList) },
        }),
        {
          get: () => Promise.resolve(apiState.teamList),
          post: (body: unknown) => {
            apiState.sentBody = body
            return Promise.resolve(apiState.createTeam)
          },
        },
      ),
    },
  }))
}
