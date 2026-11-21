import type { Role } from '@lol/shared'
import { DISPLAY_NAME_MAX, ROLE_LABELS, ROLES } from '@lol/shared'
import { Alert, Button, Card, Group, Select, Stack, Text, TextInput, Title } from '@mantine/core'
import { IconAlertCircle } from '@tabler/icons-react'
import { type SubmitEvent, useState } from 'react'
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
import { MainBadge, UnverifiedBadge } from './badges.tsx'

const roleOptions = ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }))

/**
 * The two sections a player fills in, shared by `/profile` (edit any time) and `/welcome`
 * (first login, blocking). One implementation, so the first-run form can never drift from the
 * one you edit later.
 *
 * All the deciding lives in `profile-form.ts`; these are wiring plus layout. Nothing here talks
 * to Riot: an account is a label the player typed in, and "unverified" says so.
 */

/** Display name, position preference and the optional birthday. */
export function ProfileSection() {
  const me = useMe()
  const profile = useProfile()
  const save = useSaveProfile()
  const [edited, setEdited] = useState<ProfileDraftState | null>(null)
  const [error, setError] = useState<string | null>(null)

  // `null` until the player touches a field: until then the form is derived from what was saved,
  // so the async profile arriving late still fills the inputs.
  const draft = edited ?? prefillProfile(profile.data ?? null, me.data?.name ?? '')
  const update = (patch: Partial<ProfileDraftState>) => setEdited({ ...draft, ...patch })

  function submit(event: SubmitEvent<HTMLFormElement>) {
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

  return (
    <Card padding="lg">
      <form onSubmit={submit}>
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
  )
}

/** The player's League accounts: list, add, remove, and exactly one main. */
export function AccountsSection() {
  const accounts = useRiotAccounts()
  const add = useAddRiotAccount()
  const remove = useRemoveRiotAccount()
  const setMain = useSwitchMainRiotAccount()
  const [draft, setDraft] = useState({ gameName: '', tagLine: '' })
  const [error, setError] = useState<string | null>(null)

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()

    const result = draftAccount(draft.gameName, draft.tagLine)
    if (!result.ok) {
      setError(result.message)
      return
    }

    setError(null)
    add.mutate(result.body, {
      onSuccess: () => setDraft({ gameName: '', tagLine: '' }),
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
            {accounts.data.map((account) => (
              <Group key={account.id} justify="space-between" wrap="nowrap">
                <Group gap="xs">
                  <Text fw={500}>{`${account.gameName}#${account.tagLine}`}</Text>
                  {account.isMain && <MainBadge />}
                  <UnverifiedBadge verifiedAt={account.verifiedAt} />
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
            <Group grow align="flex-end" gap="sm">
              <TextInput
                label="Game name"
                placeholder="Hide on bush"
                value={draft.gameName}
                onChange={(event) => setDraft({ ...draft, gameName: event.currentTarget.value })}
              />
              <TextInput
                label="Tag line"
                placeholder="EUW"
                value={draft.tagLine}
                onChange={(event) => setDraft({ ...draft, tagLine: event.currentTarget.value })}
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
