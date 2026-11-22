import { SHORT_NAME_MAX, TEAM_NAME_MAX } from '@lol/shared'
import { Alert, Button, Card, Stack, Text, TextInput, Title } from '@mantine/core'
import { IconAlertCircle } from '@tabler/icons-react'
import { type SubmitEvent, useState } from 'react'
import { useNavigate } from 'react-router'
// the pure module: importing ApiError from './api.ts' would drag Eden into every test too
import { ApiError } from '../api-result.ts'
import { signOut } from '../auth-client.ts'
import { useCreateTeam } from '../hooks.ts'
import { draftTeam, rosterPath, teamWriteMessage } from '../lib/team/writes.ts'

/**
 * The other way into the app besides an invite link: creating a team is what makes you its
 * captain, so this card is the whole signup — no approval step, no captain to wait for.
 * All of its thinking lives in `lib/team/writes.ts`; this is the wiring.
 */
export function CreateTeamCard({ signedInAs }: { signedInAs?: string }) {
  const [name, setName] = useState('')
  const [shortName, setShortName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const createTeam = useCreateTeam()

  // React's synthetic SubmitEvent, not the deprecated `FormEvent` ("doesn't actually exist")
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()

    const draft = draftTeam(name, shortName)
    if (!draft.ok) {
      setError(draft.message)
      return
    }

    setError(null)
    createTeam.mutate(draft.body, {
      onSuccess: (me) => {
        // `['me']` is already seeded by the hook; the slug is what the route needs
        if (me.teamSlug) navigate(rosterPath(me.teamSlug), { replace: true })
      },
      onError: (caught: Error) => {
        const status = caught instanceof ApiError ? caught.status : 0
        setError(teamWriteMessage(status, caught.message))
      },
    })
  }

  return (
    <Card maw={460} w="100%" padding="xl">
      <form onSubmit={submit}>
        <Stack gap="md">
          <Title order={3}>Create your team</Title>
          <Text size="sm" c="dimmed">
            {signedInAs ? `Signed in as ${signedInAs}. ` : ''}
            You become its captain. Or open the invite link a captain sent you.
          </Text>

          <TextInput
            label="Team name"
            placeholder="Die Besten"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            maxLength={TEAM_NAME_MAX}
            required
            autoFocus
          />
          <TextInput
            label="Short name"
            description="Optional — a few characters for badges"
            placeholder="DBW"
            value={shortName}
            onChange={(event) => setShortName(event.currentTarget.value)}
            maxLength={SHORT_NAME_MAX}
          />

          {error ? (
            <Alert color="red" icon={<IconAlertCircle size={16} />}>
              {error}
            </Alert>
          ) : null}

          <Button type="submit" loading={createTeam.isPending}>
            Create team
          </Button>
          {/* type="button": inside a form this would otherwise submit as well */}
          <Button
            type="button"
            variant="subtle"
            size="xs"
            onClick={() => void signOut().then(() => location.reload())}
          >
            Log out
          </Button>
        </Stack>
      </form>
    </Card>
  )
}
