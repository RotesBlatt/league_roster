import { missingProfileFields } from '@lol/shared'
import { Card, Center, Loader, Text, Title } from '@mantine/core'
import { Navigate, Outlet } from 'react-router'
import { isUnauthorized, useMe, useProfile, useRiotAccounts } from '../api/hooks.ts'

/**
 * The gate between "signed in" and "the app": without a **complete** profile there is nothing for
 * a captain to pick, so every member route waits behind `/welcome` (player-profiles.md §5).
 *
 * Complete is computed, never stored — so an existing player who predates the `profile` table is
 * sent to setup on their next load, with no backfill and no "seen it" flag.
 *
 * Waits for all three queries before deciding: redirecting on `undefined` would flash `/welcome`
 * at every load for people who already finished.
 */
export function RequireCompleteProfile() {
  const me = useMe()
  const profile = useProfile()
  const accounts = useRiotAccounts()

  if (me.isPending || profile.isPending || accounts.isPending) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    )
  }

  // a failed profile or account read is not "incomplete": redirecting to setup would hide the
  // actual problem and loop the user through a form that cannot save
  if (profile.isError || accounts.isError) {
    const failure = profile.isError ? profile.error : accounts.error
    return (
      <Center h="100vh">
        <Card maw={420}>
          <Title order={3}>Could not load your profile</Title>
          <Text c="dimmed" mt="xs">
            {failure?.message ?? 'Request failed'}
          </Text>
        </Card>
      </Center>
    )
  }

  if (me.isError) {
    if (isUnauthorized(me.error)) return <Navigate to="/login" replace />
    return (
      <Center h="100vh">
        <Card maw={420}>
          <Title order={3}>Something broke</Title>
          <Text c="dimmed" mt="xs">
            {me.error.message}
          </Text>
        </Card>
      </Center>
    )
  }

  const missing = missingProfileFields({
    displayName: profile.data?.displayName ?? null,
    preferredRole: profile.data?.preferredRole ?? null,
    accountCount: accounts.data?.length ?? 0,
  })

  if (missing.length > 0) return <Navigate to="/welcome" replace />

  return <Outlet />
}
