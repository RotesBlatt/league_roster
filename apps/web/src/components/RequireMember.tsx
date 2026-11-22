import { Button, Card, Center, Loader, Stack, Text, Title } from '@mantine/core'
import { Navigate } from 'react-router'
import { signOut } from '../api/auth.ts'
import { isUnauthorized, useMe } from '../api/hooks.ts'
import { AppLayout } from './AppLayout.tsx'
import { CreateTeamCard } from './CreateTeamCard.tsx'

/** Gate for every page behind "signed in + an active membership in some team". */
export function RequireMember() {
  const me = useMe()

  if (me.isPending) {
    return (
      <Center h="100vh">
        <Loader />
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

  const member = me.data
  if (!member) return null

  if (member.status === 'disabled') {
    return (
      <Center h="100vh" p="md">
        <Card maw={460} w="100%">
          <Stack>
            <Title order={3}>Access disabled</Title>
            <Text size="sm" c="dimmed">
              A captain disabled your account. Ask them to re-enable it.
            </Text>
            <Button variant="default" onClick={() => void signOut().then(() => location.reload())}>
              Log out
            </Button>
          </Stack>
        </Card>
      </Center>
    )
  }

  // No membership in any team: there is no tenant to show. Creating a team and opening an
  // invite link are the only two ways in — there is no approval queue to wait in.
  if (!member.teamSlug) {
    return (
      <Center h="100vh" p="md">
        <CreateTeamCard signedInAs={member.name} />
      </Center>
    )
  }

  return <AppLayout me={member} />
}
