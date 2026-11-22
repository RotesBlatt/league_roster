import { createAuthClient } from 'better-auth/react'

/** Talks to /api/auth/* on the same origin. */
export const authClient = createAuthClient()

export function signInWithDiscord(callbackURL: string) {
  return authClient.signIn.social({ provider: 'discord', callbackURL })
}

export function signOut() {
  return authClient.signOut()
}
