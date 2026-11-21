import type { Role } from '@lol/shared'
import { DISPLAY_NAME_MAX, ROLE_LABELS, ROLES } from '@lol/shared'
import { Alert, Button, Card, Group, Select, Stack, Text, TextInput, Title } from '@mantine/core'
import { IconAlertCircle } from '@tabler/icons-react'
import { type SubmitEvent, useEffect, useMemo, useState } from 'react'
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
  profileChanged,
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
export function ProfileSection({ saveDelayMs = 700 }: { saveDelayMs?: number } = {}) {
  const me = useMe()
  const profile = useProfile()
  const save = useSaveProfile()
  const [edited, setEdited] = useState<ProfileDraftState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // `null` until the player touches a field: until then the form derives from what was saved, so
  // the async profile arriving late still fills the inputs. Memoised so the autosave timer is not
  // reset by every unrelated render.
  const current = useMemo(
    () => edited ?? prefillProfile(profile.data ?? null, me.data?.name ?? ''),
    [edited, profile.data, me.data?.name],
  )

  const update = (patch: Partial<ProfileDraftState>) => {
    setSaved(false)
    setEdited({ ...current, ...patch })
  }

  /**
   * Autosave: a short pause after the last keystroke, and only when the draft is valid **and**
   * would change something. Both rules are pure (`profile-form.ts`), so "opening the page" or
   * "typing and undoing" hooks never write.
   */
  const mutate = save.mutate
  useEffect(() => {
    const result = draftProfile(current, todayIso())
    if (!result.ok || !profileChanged(profile.data ?? null, result.body)) return

    const timer = setTimeout(() => {
      mutate(result.body, {
        onSuccess: () => {
          setSaved(true)
          setError(null)
        },
        onError: (caught: Error) => setError(caught.message),
      })
    }, saveDelayMs)

    return () => clearTimeout(timer)
  }, [current, profile.data, saveDelayMs, mutate])

  // An empty form is indistinguishable from a broken one. If the profile could not be loaded, say
  // so — an old API process without the route is the usual cause.
  if (profile.isError) {
    return (
      <Card padding="lg">
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          Could not load your profile: {profile.error.message}
        </Alert>
      </Card>
    )
  }

  return (
    <Card padding="lg">
      {/* no submit: the fields save themselves; Enter just must not reload the page */}
      <form onSubmit={(event) => event.preventDefault()}>
        <Stack gap="md">
          <TextInput
            label="Display name"
            value={current.displayName}
            onChange={(event) => update({ displayName: event.currentTarget.value })}
            maxLength={DISPLAY_NAME_MAX}
            required
          />
          <Select
            label="Role"
            description="The position you want to play, not a permission"
            data={roleOptions}
            value={current.preferredRole}
            onChange={(value) => update({ preferredRole: value as Role | null })}
            allowDeselect={false}
          />
          <TextInput
            label="Birthday"
            description="Optional — used for the team's birthday list, and skippable"
            type="date"
            value={current.birthday}
            onChange={(event) => update({ birthday: event.currentTarget.value })}
          />

          {error ? (
            <Alert color="red" icon={<IconAlertCircle size={16} />}>
              {error}
            </Alert>
          ) : (
            <Text size="xs" c="dimmed" ta="right" aria-live="polite">
              {save.isPending ? 'Saving…' : saved ? 'Saved' : 'Changes save automatically'}
            </Text>
          )}
        </Stack>
      </form>
    </Card>
  )
}

/**
 * The player's League accounts: list, add, remove, and exactly one main.
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
  const [draft, setDraft] = useState({ gameName: '', tagLine: '' })
  const [error, setError] = useState<string | null>(null)

  const removeBlocked = !allowRemovingLast && (accounts.data?.length ?? 0) <= 1

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
