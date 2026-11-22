import { DEFAULT_RIOT_PLATFORM, PLATFORM_LABELS, type Platform, RIOT_PLATFORMS } from '@lol/shared'
import { Alert, Button, Card, Group, Select, Stack, Text, TextInput, Title } from '@mantine/core'
import { IconAlertCircle } from '@tabler/icons-react'
import { type SubmitEvent, useState } from 'react'
import {
  useAddRiotAccount,
  useRemoveRiotAccount,
  useRiotAccounts,
  useSwitchMainRiotAccount,
} from '../../api/hooks.ts'
import { draftAccount } from '../../lib/profile/profile-form.ts'
import { levelLabel } from '../../lib/profile/rank.ts'
import { MainBadge, RankBadges, UnverifiedBadge } from '../Badges.tsx'

/**
 * The player's League accounts: list, add, remove, and exactly one main. Shared by `/profile` and
 * `/welcome` together with `ProfileSection`, so the first-run form cannot drift from the one you
 * edit later.
 *
 * Nothing here talks to Riot: an account is a label the player typed in, and "unverified" says so.
 * The deciding lives in `profile-form.ts`.
 *
 * `allowRemovingLast` is the one difference between the two entry points: on `/welcome` a mistyped
 * Riot ID must be deletable (down to zero, then add the right one), while on `/profile` removing
 * the last account would make the profile incomplete and bounce the player straight back to
 * setup — so there it is refused, with the reason shown.
 */
export function AccountsSection({
  allowRemovingLast = false,
}: {
  allowRemovingLast?: boolean
} = {}) {
  const accounts = useRiotAccounts()
  const add = useAddRiotAccount()
  const remove = useRemoveRiotAccount()
  const setMain = useSwitchMainRiotAccount()
  const [draft, setDraft] = useState({
    gameName: '',
    tagLine: '',
    platform: DEFAULT_RIOT_PLATFORM as Platform,
  })
  const [error, setError] = useState<string | null>(null)

  const removeBlocked = !allowRemovingLast && (accounts.data?.length ?? 0) <= 1

  function update(patch: Partial<typeof draft>) {
    setDraft({ ...draft, ...patch })
  }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()

    const result = draftAccount(draft.gameName, draft.tagLine, draft.platform)
    if (!result.ok) {
      setError(result.message)
      return
    }

    setError(null)
    add.mutate(result.body, {
      onSuccess: () => setDraft({ gameName: '', tagLine: '', platform: draft.platform }),
      onError: (caught: Error) => setError(caught.message),
    })
  }

  return (
    <Card padding="lg">
      <Stack gap="md">
        <div>
          <Title order={4}>League accounts</Title>
          <Text size="sm" c="dimmed">
            Your Riot IDs, exactly as in the client: name#tag. Mark the one you play real games on
            as main.
          </Text>
        </div>

        {accounts.data?.length ? (
          <Stack gap="xs">
            {removeBlocked ? (
              <Text size="xs" c="dimmed">
                You need at least one account. Add the new one before removing this one.
              </Text>
            ) : null}
            {accounts.data.map((account) => (
              <Group key={account.id} justify="space-between" wrap="nowrap">
                <Group gap="xs">
                  <Text fw={500}>{`${account.gameName}#${account.tagLine}`}</Text>
                  {account.isMain && <MainBadge />}
                  <UnverifiedBadge verifiedAt={account.verifiedAt} />
                  <RankBadges ranks={account.ranks} />
                  {levelLabel(account) ? (
                    <Text size="sm" c="dimmed">
                      {levelLabel(account)}
                    </Text>
                  ) : null}
                </Group>
                <Group gap="xs">
                  {!account.isMain && (
                    <Button
                      variant="default"
                      size="compact-sm"
                      onClick={() => setMain.mutate(account.id)}
                      loading={setMain.isPending}
                    >
                      Set main
                    </Button>
                  )}
                  <Button
                    variant="subtle"
                    color="red"
                    size="compact-sm"
                    onClick={() => remove.mutate(account.id)}
                    loading={remove.isPending}
                    disabled={removeBlocked}
                  >
                    Remove
                  </Button>
                </Group>
              </Group>
            ))}
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">
            No account yet.
          </Text>
        )}

        <form onSubmit={submit}>
          <Stack gap="sm">
            <Select
              label="Platform"
              description="Where the account plays — the region is what decides who answers"
              data={RIOT_PLATFORMS.map((platform) => ({
                value: platform,
                label: PLATFORM_LABELS[platform],
              }))}
              value={draft.platform}
              onChange={(value) =>
                update({ platform: (value ?? DEFAULT_RIOT_PLATFORM) as Platform })
              }
              allowDeselect={false}
              searchable
            />

            <Group grow align="flex-end" gap="sm">
              <TextInput
                label="Game name"
                placeholder="Hide on bush"
                value={draft.gameName}
                onChange={(event) => update({ gameName: event.currentTarget.value })}
              />
              <TextInput
                label="Tag line"
                placeholder="EUW"
                value={draft.tagLine}
                onChange={(event) => update({ tagLine: event.currentTarget.value })}
              />
            </Group>

            {error ? (
              <Alert color="red" icon={<IconAlertCircle size={16} />}>
                {error}
              </Alert>
            ) : null}

            <Group justify="flex-end">
              <Button type="submit" variant="light" loading={add.isPending}>
                Add account
              </Button>
            </Group>
          </Stack>
        </form>
      </Stack>
    </Card>
  )
}
