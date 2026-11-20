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
  /** GET /api/teams — the switcher's list */
  teamList: Result
  /** POST /api/teams */
  createTeam: Result
  /** the body handed to POST /api/teams, for assertions */
  sentBody: unknown
} = {
  teamList: { data: [], error: null, status: 200 },
  createTeam: { data: null, error: null, status: 200 },
  sentBody: undefined,
}

export function resetApiState() {
  apiState.teamList = { data: [], error: null, status: 200 }
  apiState.createTeam = { data: null, error: null, status: 200 }
  apiState.sentBody = undefined
}

/** Call once per test file, before importing the components under test. */
export function installApiMock() {
  mock.module('../src/api.ts', () => ({
    ApiError,
    unwrap,
    api: {
      teams: {
        get: () => Promise.resolve(apiState.teamList),
        post: (body: unknown) => {
          apiState.sentBody = body
          return Promise.resolve(apiState.createTeam)
        },
      },
    },
  }))
}
