import { Alert, Button, Card, Center, Group, Loader, Stack, Text, Title } from '@mantine/core'
import { IconAlertCircle, IconBrandDiscord, IconUsersGroup } from '@tabler/icons-react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { api, unwrap } from '../api.ts'
import { signInWithDiscord } from '../auth-client.ts'
import { isUnauthorized, useMe } from '../hooks.ts'

/** /join/:code — signs the visitor in (if needed) and claims the invite. */
export function JoinPage() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const me = useMe()

  // ref, not state: StrictMode runs effects twice, and every claim burns an invite use
  const started = useRef(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!code || started.current) return
    if (me.isPending || !me.data || me.data.status === 'active') return

    started.current = true
    unwrap(api.invites.claim.post({ code }))
      .then(() => queryClient.invalidateQueries({ queryKey: ['me'] }))
      .then(() => navigate('/roster', { replace: true }))
      .catch((err: Error) => {
        started.current = false
        setError(err.message)
      })
  }, [code, me.data, me.isPending, navigate, queryClient])

  if (!code) return null

  if (me.isPending) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    )
  }

  // not signed in (or session expired) -> offer OAuth, come back to this same URL
  if (isUnauthorized(me.error) || !me.data) {
    return (
      <Center h="100vh" p="md">
        <Card maw={420} w="100%" padding="xl">
          <Stack>
            <Title order={3}>You have been invited</Title>
            <Text size="sm" c="dimmed">
              Sign in with Discord to join the team.
            </Text>
            <Button
              leftSection={<IconBrandDiscord size={20} />}
              onClick={() =>
                void signInWithDiscord(`${window.location.origin}/join/${encodeURIComponent(code)}`)
              }
            >
              Continue with Discord
            </Button>
          </Stack>
        </Card>
      </Center>
    )
  }

  if (me.data.status === 'active') {
    return (
      <Center h="100vh" p="md">
        <Card maw={420} w="100%">
          <Stack>
            <Title order={3}>Already on the team</Title>
            <Text size="sm" c="dimmed">
              You are signed in as {me.data.name}.
            </Text>
            <Button leftSection={<IconUsersGroup size={18} />} onClick={() => navigate('/roster')}>
              Go to roster
            </Button>
          </Stack>
        </Card>
      </Center>
    )
  }

  if (error) {
    return (
      <Center h="100vh" p="md">
        <Card maw={460} w="100%">
          <Stack>
            <Alert color="red" icon={<IconAlertCircle size={16} />} title="Could not claim invite">
              {error}
            </Alert>
            <Text size="sm" c="dimmed">
              Ask a captain for a fresh invite link, or wait until they approve you manually.
            </Text>
            <Group>
              <Button variant="default" onClick={() => navigate(0)}>
                Try again
              </Button>
            </Group>
          </Stack>
        </Card>
      </Center>
    )
  }

  return (
    <Center h="100vh" p="md">
      <Stack align="center" gap="sm">
        <Loader />
        <Text size="sm" c="dimmed">
          Claiming invite {code} for {me.data.name}…
        </Text>
      </Stack>
    </Center>
  )
}
