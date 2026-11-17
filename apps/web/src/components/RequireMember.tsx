import { Button, Card, Center, Loader, Stack, Text, Title } from '@mantine/core'
import { Navigate } from 'react-router'
import { signOut } from '../auth-client.ts'
import { isUnauthorized, useMe } from '../hooks.ts'
import { AppLayout } from './AppLayout.tsx'

/** Gate for every page behind "signed in + approved by a captain". */
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

  if (member.status !== 'active') {
    return (
      <Center h="100vh" p="md">
        <Card maw={460} w="100%">
          <Stack>
            <Title order={3}>
              {member.status === 'disabled' ? 'Access disabled' : 'Waiting for approval'}
            </Title>
            <Text size="sm" c="dimmed">
              {member.status === 'disabled'
                ? 'A captain disabled your account. Ask them to re-enable it.'
                : `You are signed in as ${member.name}. A captain has to approve you — or open the invite link they sent you.`}
            </Text>
            <Button variant="default" onClick={() => void signOut().then(() => location.reload())}>
              Log out
            </Button>
          </Stack>
        </Card>
      </Center>
    )
  }

  return <AppLayout me={member} />
}
