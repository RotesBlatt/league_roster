import type { Role } from '@lol/shared'
import { DISPLAY_NAME_MAX, ROLE_LABELS, ROLES } from '@lol/shared'
import { Alert, Card, Select, Stack, Text, TextInput } from '@mantine/core'
import { IconAlertCircle } from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'
import { useMe, useProfile, useSaveProfile } from '../../api/hooks.ts'
import {
  draftProfile,
  type ProfileDraftState,
  prefillProfile,
  profileChanged,
  todayIso,
} from '../../profile-form.ts'

const roleOptions = ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }))

/**
 * The player's own details — name, position, optional birthday — shared by `/profile` (edit any
 * time) and `/welcome` (first login, blocking), together with `AccountsSection`. One
 * implementation, so the first-run form can never drift from the one you edit later.
 *
 * All the deciding lives in `profile-form.ts`; this is wiring plus layout.
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
