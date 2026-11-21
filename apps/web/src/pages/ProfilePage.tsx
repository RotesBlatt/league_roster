import type { Role } from '@lol/shared'
import { DISPLAY_NAME_MAX, ROLE_LABELS, ROLES } from '@lol/shared'
import { Alert, Button, Card, Group, Select, Stack, Text, TextInput, Title } from '@mantine/core'
import { IconAlertCircle } from '@tabler/icons-react'
import { type SubmitEvent, useState } from 'react'
import { MainBadge, UnverifiedBadge } from '../components/badges.tsx'
import {
  useAddRiotAccount,
  useMe,
  useProfile,
  useRemoveRiotAccount,
  useRiotAccounts,
  useSaveProfile,
  useSwitchMainRiotAccount,
} from '../hooks.ts'
import {
  draftAccount,
  draftProfile,
  type ProfileDraftState,
  prefillProfile,
  todayIso,
} from '../profile-form.ts'

const roleOptions = ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }))

/**
 * The player's own page: display name, position preference, optional birthday, and their League
 * accounts. All the deciding lives in `profile-form.ts`; this is the wiring plus layout.
 *
 * Nothing here talks to Riot. An account is a label the player typed in — "unverified" says so,
 * and the page is fully usable while the Riot key is missing, expired or rate-limited
 * (docs/ideas/integrations/riot-api.md §5).
 */
export function ProfilePage() {
  const me = useMe()
  const profile = useProfile()
  const accounts = useRiotAccounts()
  const save = useSaveProfile()
  const add = useAddRiotAccount()
  const remove = useRemoveRiotAccount()
  const setMain = useSwitchMainRiotAccount()

  // `null` until the player touches a field: until then the form is derived from what was saved,
  // so the async profile arriving late still fills the inputs.
  const [edited, setEdited] = useState<ProfileDraftState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [accountDraft, setAccountDraft] = useState({ gameName: '', tagLine: '' })
  const [accountError, setAccountError] = useState<string | null>(null)

  const draft = edited ?? prefillProfile(profile.data ?? null, me.data?.name ?? '')
  const update = (patch: Partial<ProfileDraftState>) => setEdited({ ...draft, ...patch })

  function submitProfile(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()

    const result = draftProfile(draft, todayIso())
    if (!result.ok) {
      setError(result.message)
      return
    }

    setError(null)
    save.mutate(result.body, {
      onError: (caught: Error) => setError(caught.message),
    })
  }

  function submitAccount(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()

    const result = draftAccount(accountDraft.gameName, accountDraft.tagLine)
    if (!result.ok) {
      setAccountError(result.message)
      return
    }

    setAccountError(null)
    add.mutate(result.body, {
      onSuccess: () => setAccountDraft({ gameName: '', tagLine: '' }),
      onError: (caught: Error) => setAccountError(caught.message),
    })
  }

  return (
    <Stack gap="lg" maw={640}>
      <div>
        <Title order={2}>My profile</Title>
        <Text size="sm" c="dimmed">
          This is yours — the roster shows it, so edit it here and nowhere else.
        </Text>
      </div>

      <Card padding="lg">
        <form onSubmit={submitProfile}>
          <Stack gap="md">
            <TextInput
              label="Display name"
              value={draft.displayName}
              onChange={(event) => update({ displayName: event.currentTarget.value })}
              maxLength={DISPLAY_NAME_MAX}
              required
            />
            <Select
              label="Role"
              description="The position you want to play, not a permission"
              data={roleOptions}
              value={draft.preferredRole}
              onChange={(value) => update({ preferredRole: value as Role | null })}
              allowDeselect={false}
            />
            <TextInput
              label="Birthday"
              description="Optional — used for the team's birthday list, and skippable"
              type="date"
              value={draft.birthday}
              onChange={(event) => update({ birthday: event.currentTarget.value })}
            />

            {error ? (
              <Alert color="red" icon={<IconAlertCircle size={16} />}>
                {error}
              </Alert>
            ) : null}

            <Group justify="flex-end">
              <Button type="submit" loading={save.isPending}>
                Save
              </Button>
            </Group>
          </Stack>
        </form>
      </Card>

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
              {accounts.data.map((account) => (
                <Group key={account.id} justify="space-between" wrap="nowrap">
                  <Group gap="xs">
                    <Text fw={500}>{`${account.gameName}#${account.tagLine}`}</Text>
                    {account.isMain ? <MainBadge /> : null}
                    <UnverifiedBadge verifiedAt={account.verifiedAt} />
                  </Group>
                  <Group gap="xs">
                    {account.isMain ? null : (
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

          <form onSubmit={submitAccount}>
            <Stack gap="sm">
              <Group grow align="flex-end" gap="sm">
                <TextInput
                  label="Game name"
                  placeholder="Hide on bush"
                  value={accountDraft.gameName}
                  onChange={(event) =>
                    setAccountDraft({ ...accountDraft, gameName: event.currentTarget.value })
                  }
                />
                <TextInput
                  label="Tag line"
                  placeholder="EUW"
                  value={accountDraft.tagLine}
                  onChange={(event) =>
                    setAccountDraft({ ...accountDraft, tagLine: event.currentTarget.value })
                  }
                />
              </Group>

              {accountError ? (
                <Alert color="red" icon={<IconAlertCircle size={16} />}>
                  {accountError}
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
    </Stack>
  )
}
