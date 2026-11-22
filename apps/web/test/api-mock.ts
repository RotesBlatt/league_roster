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
  /** GET /api/me/profile */
  profile: Result
  /** PUT /api/me/profile */
  profileSave: Result
  /** GET /api/teams/:slug/roster */
  rosterList: Result
  /** POST /api/teams/:slug/roster */
  rosterAdd: Result
  /** PATCH /api/teams/:slug/roster/:id */
  rosterUpdate: Result
  /** DELETE /api/teams/:slug/roster/:id */
  rosterRemove: Result
  /** GET /api/me/riot-accounts */
  riotAccountList: Result
  /** POST /api/me/riot-accounts */
  riotAccountAdd: Result
  /** GET /api/teams/:slug/planner */
  planner: Result
  /** PUT /api/teams/:slug/planner/:startsOn */
  plannerSave: Result
  /** GET /api/teams/:slug/planner/template */
  plannerTemplate: Result
  /** PUT /api/teams/:slug/planner/template */
  plannerTemplateSave: Result
  /** the bodies handed to the planner writes, for assertions */
  sentPlanner: unknown
  sentPlannerTemplate: unknown
  /** DELETE /api/me/riot-accounts/:id */
  riotAccountRemove: Result
  /** PUT /api/me/riot-accounts/:id/main */
  riotAccountSwitch: Result
  /** the body handed to POST /api/teams, for assertions */
  sentBody: unknown
  /** the body handed to PATCH /api/teams/:slug, for assertions */
  sentRename: unknown
  /** the body handed to PUT /api/me/profile */
  sentProfile: unknown
  /** the body handed to POST /api/me/riot-accounts */
  sentAccount: unknown
  /** the id handed to a riot-account delete or switch */
  sentAccountId: string | undefined
  /** the bodies handed to the roster writes, for assertions */
  sentRoster: unknown
  sentRosterPatch: unknown
  /** how often each GET was called, so cache behaviour is observable */
  calls: { profileGet: number; riotAccountsGet: number; rosterGet: number; plannerGet: number }
  /** a never-resolving GET, for testing loaders without a real slow network */
  pending: { me: boolean }
} = {
  me: { data: null, error: null, status: 200 },
  inviteList: { data: [], error: null, status: 200 },
  memberList: { data: [], error: null, status: 200 },
  teamList: { data: [], error: null, status: 200 },
  createTeam: { data: null, error: null, status: 200 },
  renameTeam: { data: null, error: null, status: 200 },
  profile: { data: null, error: null, status: 200 },
  profileSave: { data: null, error: null, status: 200 },
  rosterList: { data: [], error: null, status: 200 },
  rosterAdd: { data: { ok: true }, error: null, status: 200 },
  rosterUpdate: { data: { ok: true }, error: null, status: 200 },
  rosterRemove: { data: { ok: true }, error: null, status: 200 },
  riotAccountList: { data: [], error: null, status: 200 },
  riotAccountAdd: { data: null, error: null, status: 200 },
  riotAccountRemove: { data: { ok: true }, error: null, status: 200 },
  riotAccountSwitch: { data: null, error: null, status: 200 },
  planner: { data: null, error: null, status: 200 },
  plannerSave: { data: { ok: true }, error: null, status: 200 },
  plannerTemplate: { data: { days: [] }, error: null, status: 200 },
  plannerTemplateSave: { data: { ok: true }, error: null, status: 200 },
  sentPlanner: undefined,
  sentPlannerTemplate: undefined,
  sentBody: undefined,
  sentRename: undefined,
  sentProfile: undefined,
  sentAccount: undefined,
  sentAccountId: undefined,
  sentRoster: undefined,
  sentRosterPatch: undefined,
  calls: { profileGet: 0, riotAccountsGet: 0, rosterGet: 0, plannerGet: 0 },
  pending: { me: false },
}

export function resetApiState() {
  apiState.me = { data: null, error: null, status: 200 }
  apiState.inviteList = { data: [], error: null, status: 200 }
  apiState.memberList = { data: [], error: null, status: 200 }
  apiState.teamList = { data: [], error: null, status: 200 }
  apiState.createTeam = { data: null, error: null, status: 200 }
  apiState.renameTeam = { data: null, error: null, status: 200 }
  apiState.profile = { data: null, error: null, status: 200 }
  apiState.profileSave = { data: null, error: null, status: 200 }
  apiState.rosterList = { data: [], error: null, status: 200 }
  apiState.rosterAdd = { data: { ok: true }, error: null, status: 200 }
  apiState.rosterUpdate = { data: { ok: true }, error: null, status: 200 }
  apiState.rosterRemove = { data: { ok: true }, error: null, status: 200 }
  apiState.riotAccountList = { data: [], error: null, status: 200 }
  apiState.riotAccountAdd = { data: null, error: null, status: 200 }
  apiState.riotAccountRemove = { data: { ok: true }, error: null, status: 200 }
  apiState.riotAccountSwitch = { data: null, error: null, status: 200 }
  apiState.planner = { data: null, error: null, status: 200 }
  apiState.plannerSave = { data: { ok: true }, error: null, status: 200 }
  apiState.plannerTemplate = { data: { days: [] }, error: null, status: 200 }
  apiState.plannerTemplateSave = { data: { ok: true }, error: null, status: 200 }
  apiState.sentPlanner = undefined
  apiState.sentPlannerTemplate = undefined
  apiState.sentBody = undefined
  apiState.sentRename = undefined
  apiState.sentProfile = undefined
  apiState.sentAccount = undefined
  apiState.sentAccountId = undefined
  apiState.sentRoster = undefined
  apiState.sentRosterPatch = undefined
  apiState.calls = { profileGet: 0, riotAccountsGet: 0, rosterGet: 0, plannerGet: 0 }
  apiState.pending = { me: false }
}

/** Call once per test file, before importing the components under test. */
export function installApiMock() {
  mock.module('../src/api.ts', () => ({
    ApiError,
    unwrap,
    api: {
      me: {
        // a pending query is a promise that never settles — no timers, no fake slow network
        get: () =>
          apiState.pending.me ? new Promise<never>(() => {}) : Promise.resolve(apiState.me),
        profile: {
          get: () => {
            apiState.calls.profileGet += 1
            return Promise.resolve(apiState.profile)
          },
          put: (body: unknown) => {
            apiState.sentProfile = body
            return Promise.resolve(apiState.profileSave)
          },
        },
        // same shape as `teams`: callable for the path param, verbs on the collection.
        // The key is Eden's: it keeps the dash from `/riot-accounts`.
        'riot-accounts': Object.assign(
          (params: { id: string }) => ({
            delete: () => {
              apiState.sentAccountId = params.id
              return Promise.resolve(apiState.riotAccountRemove)
            },
            main: {
              put: () => {
                apiState.sentAccountId = params.id
                return Promise.resolve(apiState.riotAccountSwitch)
              },
            },
          }),
          {
            get: () => {
              apiState.calls.riotAccountsGet += 1
              return Promise.resolve(apiState.riotAccountList)
            },
            post: (body: unknown) => {
              apiState.sentAccount = body
              return Promise.resolve(apiState.riotAccountAdd)
            },
          },
        ),
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
          // same shape again: callable for :id, verbs on the collection
          roster: Object.assign(
            (params: { id: string }) => ({
              patch: (body: unknown) => {
                apiState.sentRosterPatch = { id: params.id, body }
                return Promise.resolve(apiState.rosterUpdate)
              },
              delete: () => {
                apiState.sentRosterPatch = { id: params.id }
                return Promise.resolve(apiState.rosterRemove)
              },
            }),
            {
              get: () => {
                apiState.calls.rosterGet += 1
                return Promise.resolve(apiState.rosterList)
              },
              post: (body: unknown) => {
                apiState.sentRoster = body
                return Promise.resolve(apiState.rosterAdd)
              },
            },
          ),
          members: { get: () => Promise.resolve(apiState.memberList) },
          // callable for :startsOn, verbs on the collection — same shape as `roster`
          planner: Object.assign(
            (params: { startsOn: string }) => ({
              put: (body: unknown) => {
                apiState.sentPlanner = { startsOn: params.startsOn, body }
                return Promise.resolve(apiState.plannerSave)
              },
            }),
            {
              get: () => {
                apiState.calls.plannerGet += 1
                return Promise.resolve(apiState.planner)
              },
              template: {
                get: () => Promise.resolve(apiState.plannerTemplate),
                put: (body: unknown) => {
                  apiState.sentPlannerTemplate = body
                  return Promise.resolve(apiState.plannerTemplateSave)
                },
              },
            },
          ),
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
