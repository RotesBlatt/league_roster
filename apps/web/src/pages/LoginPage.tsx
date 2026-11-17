import { Button, Card, Center, Stack, Text, Title } from '@mantine/core'
import { IconBrandDiscord } from '@tabler/icons-react'
import { Navigate } from 'react-router'
import { signInWithDiscord } from '../auth-client.ts'
import { useMe } from '../hooks.ts'

export function LoginPage() {
  const me = useMe()

  if (me.data?.status === 'active') return <Navigate to="/roster" replace />

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
            onClick={() => void signInWithDiscord(`${window.location.origin}/roster`)}
          >
            Continue with Discord
          </Button>
          <Text size="xs" c="dimmed">
            Ask a captain for an invite link if you are not on the team yet.
          </Text>
        </Stack>
      </Card>
    </Center>
  )
}
