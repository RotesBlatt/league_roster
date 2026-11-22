import type { TeamDto, TeamSummary } from '@lol/api/schema-types'
import { SHORT_NAME_MAX, TEAM_NAME_MAX } from '@lol/shared'
import { Alert, Button, Card, Group, Stack, Text, TextInput, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertCircle } from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type SubmitEvent, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
// the pure modules: importing ApiError from './api/api.ts' would drag Eden into every test too
import { ApiError, api, unwrap } from '../../api/api.ts'
import { teamPathWithSlug } from '../../lib/team/route.ts'
import { draftRename, renameTeamMessage } from '../../lib/team/writes.ts'

/**
 * The captain's rename (team-rename.md §3–4). The slug follows the name, so saving usually
 * changes the team's URL — which is why this navigates instead of just refetching, and why the
 * form says so. All of the thinking lives in `lib/team/writes.ts`; this is the wiring.
 *
 * Mount it with `key={team.id}`: the name is local form state, seeded once from the team.
 */
export function TeamSettingsCard({ team }: { team: TeamSummary }) {
  const [name, setName] = useState(team.name)
  const [shortName, setShortName] = useState(team.shortName ?? '')
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const queryClient = useQueryClient()

  const draft = draftRename({
    currentName: team.name,
    currentShortName: team.shortName,
    name,
    shortName,
  })
  const blocked = !draft.ok || draft.unchanged

  const rename = useMutation({
    mutationFn: (body: { name: string; shortName: string }) =>
      unwrap(api.teams({ slug: team.slug }).patch(body)),
    onSuccess: (renamed: TeamDto) => {
      // seed the switcher's row first, so the new slug resolves the moment we navigate;
      // the invalidations are for the server's truth, not for this render
      queryClient.setQueryData<TeamSummary[]>(['teams'], (teams) =>
        teams?.map((row) => (row.id === renamed.id ? { ...row, ...renamed } : row)),
      )
      void queryClient.invalidateQueries({ queryKey: ['teams'] })
      void queryClient.invalidateQueries({ queryKey: ['me'] })

      notifications.show({ message: 'Team saved', color: 'brand' })

      // same slug (only the tag or the letter case changed): stay put. Otherwise the URL moves,
      // but the page does not: the card is on the admin page, so that is where you land
      if (renamed.slug !== team.slug) navigate(teamPathWithSlug(pathname, renamed.slug))
    },
    onError: (caught: Error) => {
      const status = caught instanceof ApiError ? caught.status : 0
      setError(renameTeamMessage(status, caught.message))
    },
  })

  // React's synthetic SubmitEvent, not the deprecated `FormEvent` ("doesn't actually exist")
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft.ok) return

    setError(null)
    rename.mutate(draft.body)
  }

  const shownError = draft.ok ? error : draft.message

  return (
    <Card>
      <form onSubmit={submit}>
        <Stack gap="md">
          <Title order={4}>Team</Title>
          <Text size="sm" c="dimmed">
            Renaming changes the team's URL too — links to the old one stop working.
          </Text>

          <Group align="flex-end" wrap="wrap">
            <TextInput
              label="Team name"
              flex={1}
              miw={220}
              maxLength={TEAM_NAME_MAX}
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
            />
            <TextInput
              label="Short name"
              description="Optional badge tag"
              w={140}
              maxLength={SHORT_NAME_MAX}
              value={shortName}
              onChange={(event) => setShortName(event.currentTarget.value)}
            />
            <Button type="submit" disabled={blocked} loading={rename.isPending}>
              Save
            </Button>
          </Group>

          {shownError ? (
            <Alert color="red" icon={<IconAlertCircle size={16} />}>
              {shownError}
            </Alert>
          ) : null}
        </Stack>
      </form>
    </Card>
  )
}
