import { Button, Card, Center, Stack, Text, Title } from '@mantine/core'
import { IconBrandDiscord } from '@tabler/icons-react'
import { Navigate } from 'react-router'
import { signInWithDiscord } from '../auth-client.ts'
import { useMe } from '../hooks.ts'

export function LoginPage() {
  const me = useMe()

  // Already in a team: go straight there. Without one there is nothing to show, and
  // only an invite link can change that — so the card stays.
  if (me.data?.teamSlug) return <Navigate to={`/t/${me.data.teamSlug}/roster`} replace />

  return (
    <Center h="100vh" p="md">
      <Card maw={420} w="100%" padding="xl">
        <Stack gap="md">
          <Title order={2}>Team</Title>
          <Text size="sm" c="dimmed">
            Roster, availability and scrims — one place instead of a spreadsheet.
          </Text>
          <Button
            size="md"
            leftSection={<IconBrandDiscord size={20} />}
            loading={me.isPending}
            onClick={() => void signInWithDiscord(`${window.location.origin}/`)}
          >
            Continue with Discord
          </Button>
          <Text size="xs" c="dimmed">
            {me.data
              ? `Signed in as ${me.data.name}. You are not on a team yet — open the invite link a captain sent you.`
              : 'Ask a captain for an invite link if you are not on the team yet.'}
          </Text>
        </Stack>
      </Card>
    </Center>
  )
}
