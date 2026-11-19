import { Elysia } from 'elysia'
import type { Auth } from '../auth.ts'
import type { Db } from '../db/index.ts'
import type { Me } from '../db/schema.types.ts'
import { getMe, meForTeam } from '../lib/access.ts'
import { getMembership, getTeamBySlug, type TeamRow } from '../lib/teams.ts'

const NOT_SIGNED_IN = { message: 'Not signed in' }
const NOT_FOUND = { message: 'Not found' }
const NOT_ACTIVE = { message: 'Membership is not active' }
const CAPTAIN_ONLY = { message: 'Captain only' }

type Deps = { auth: Auth; db: Db }

/** what better-auth returns from getSession, minus the null it adds when signed out */
type Session = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>

/**
 * Who is asking, and (for a team route) which team the URL names and what their
 * membership in it says. Everything the guards need to decide, in one place.
 */
type Access =
  | { kind: 'unauthorized' }
  | { kind: 'not-found' }
  | { kind: 'inactive' }
  | { kind: 'ok'; user: Session['user']; session: Session['session']; me: Me; team: TeamRow }

const slugOf = (params: unknown): string | undefined => (params as { slug?: string }).slug

/** Signed in, with `Me` read straight from the membership. No team involved. */
async function resolveIdentity(
  deps: Deps,
  headers: Headers,
): Promise<
  | { kind: 'unauthorized' }
  | { kind: 'ok'; user: Session['user']; session: Session['session']; me: Me }
> {
  const session = await deps.auth.api.getSession({ headers })
  if (!session) return { kind: 'unauthorized' }

  // a session whose user row is gone is not a usable identity
  const me = await getMe(deps.db, session.user.id)
  if (!me) return { kind: 'unauthorized' }

  return { kind: 'ok', user: session.user, session: session.session, me }
}

/**
 * The team in the path is the tenant; the session never decides it.
 * A team you are not a member of answers exactly like a team that does not exist —
 * 404, never 403, so the response cannot confirm that another team exists.
 */
async function resolveTeamAccess(
  deps: Deps,
  headers: Headers,
  slug: string | undefined,
): Promise<Access> {
  const identity = await resolveIdentity(deps, headers)
  if (identity.kind === 'unauthorized') return identity
  if (!slug) return { kind: 'not-found' }

  const team = await getTeamBySlug(deps.db, slug)
  if (!team) return { kind: 'not-found' }

  const membership = await getMembership(deps.db, { teamId: team.id, userId: identity.user.id })
  if (!membership) return { kind: 'not-found' }
  if (membership.status !== 'active') return { kind: 'inactive' }

  const { user } = identity
  return {
    kind: 'ok',
    user,
    session: identity.session,
    team,
    me: meForTeam(
      { id: user.id, name: user.name, email: user.email, image: user.image ?? null },
      team,
      membership,
    ),
  }
}

/**
 * Route guards used by the API routes:
 *   { auth: true }         -> signed in (global; live between "signed in" and "in a team")
 *   { teamMember: true }   -> signed in + member of the team named in `:slug`
 *   { teamCaptain: true }  -> ... and captain of that team
 *
 * Team guards never bootstrap a team: a request to /api/teams/x cannot create one.
 *
 * The better-auth HTTP handler itself is wired up in app.ts via onRequest, because
 * .mount(auth.handler) is only reached when nothing else answers a request.
 */
export function createAuthPlugin(deps: Deps) {
  return new Elysia({ name: 'auth' }).macro({
    auth: {
      async resolve({ status, request }) {
        const identity = await resolveIdentity(deps, request.headers)
        if (identity.kind === 'unauthorized') return status(401, NOT_SIGNED_IN)
        return { user: identity.user, session: identity.session, me: identity.me }
      },
    },
    teamMember: {
      async resolve({ status, request, params }) {
        const access = await resolveTeamAccess(deps, request.headers, slugOf(params))
        if (access.kind === 'unauthorized') return status(401, NOT_SIGNED_IN)
        if (access.kind === 'not-found') return status(404, NOT_FOUND)
        if (access.kind === 'inactive') return status(403, NOT_ACTIVE)
        return contextOf(access)
      },
    },
    teamCaptain: {
      async resolve({ status, request, params }) {
        const access = await resolveTeamAccess(deps, request.headers, slugOf(params))
        if (access.kind === 'unauthorized') return status(401, NOT_SIGNED_IN)
        if (access.kind === 'not-found') return status(404, NOT_FOUND)
        if (access.kind === 'inactive') return status(403, NOT_ACTIVE)
        if (access.me.role !== 'captain') return status(403, CAPTAIN_ONLY)
        return contextOf(access)
      },
    },
  })
}

/** What a route handler receives: `kind` stays internal to the guard. */
function contextOf(access: Extract<Access, { kind: 'ok' }>): Omit<typeof access, 'kind'> {
  const { kind: _kind, ...ctx } = access
  return ctx
}

export type AuthPlugin = ReturnType<typeof createAuthPlugin>
