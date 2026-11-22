import { Button, Card, Center, Stack, Text, Title } from '@mantine/core'
import { IconBrandDiscord } from '@tabler/icons-react'
import { Navigate } from 'react-router'
import { signInWithDiscord } from '../api/auth.ts'
import { useMe } from '../api/hooks.ts'
import { CreateTeamCard } from '../components/CreateTeamCard.tsx'

export function LoginPage() {
  const me = useMe()

  // Already in a team: go straight there.
  if (me.data?.teamSlug) return <Navigate to={`/t/${me.data.teamSlug}/roster`} replace />

  // Signed in but in no team: creating one is the other way in, so offer it here rather
  // than telling the visitor to go and find an invite link.
  if (me.data) {
    return (
      <Center h="100vh" p="md">
        <CreateTeamCard signedInAs={me.data.name} />
      </Center>
    )
  }

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
            Ask a captain for an invite link if you are not on the team yet — or create your own
            team after signing in.
          </Text>
        </Stack>
      </Card>
    </Center>
  )
}
