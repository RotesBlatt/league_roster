import { missingProfileFields, type ProfileField } from '@lol/shared'
import { Button, Group, Stack, Text, Title } from '@mantine/core'
import { Navigate, useNavigate } from 'react-router'
import { isUnauthorized, useMe, useProfile, useRiotAccounts } from '../api/hooks.ts'
import { AccountsSection } from '../components/profile/AccountsSection.tsx'
import { ProfileSection } from '../components/profile/ProfileSection.tsx'

/** What a person reads in place of a field name. */
const MISSING_LABELS: Record<ProfileField, string> = {
  displayName: 'a display name',
  preferredRole: 'your role',
  riotAccount: 'a League account',
}

/**
 * First login. **Blocking**, unlike the "skippable" option the idea doc floats: the roster pool is
 * built from this, so a player without it cannot be picked, and leaving the app half-set-up would
 * just move the confusion to the captain.
 *
 * Both the "still missing" line and the enabled state of Continue come from `missingProfileFields`
 * — the same function the route gate uses. There is no second rule to drift.
 */
export function WelcomePage() {
  const navigate = useNavigate()
  const me = useMe()
  const profile = useProfile()
  const accounts = useRiotAccounts()

  // the page sits outside `RequireCompleteProfile`, so it is the only thing that can turn a
  // signed-out visitor away — a form that cannot save would be worse than a login screen
  if (me.isError && isUnauthorized(me.error)) return <Navigate to="/login" replace />

  // computed from what the server has, not from the form's unsaved edits: "Continue" must mean
  // "it is saved", or the gate would bounce you straight back
  const missing = missingProfileFields({
    displayName: profile.data?.displayName ?? null,
    preferredRole: profile.data?.preferredRole ?? null,
    accountCount: accounts.data?.length ?? 0,
  })

  return (
    <Stack gap="lg" maw={640} mx="auto" py="xl">
      <div>
        <Title order={2}>Set up your profile</Title>
        <Text size="sm" c="dimmed" mt="xs">
          The roster is built from this: the name your team sees, the position you play, and at
          least one League account. You can change all of it later on your profile page.
        </Text>
      </div>

      <ProfileSection />
      {/* setup: a wrong Riot ID must be removable, even if it is the only one */}
      <AccountsSection allowRemovingLast />

      <Group justify="space-between" align="center">
        {missing.length > 0 ? (
          <Text data-missing size="sm" c="dimmed">
            Still missing: {missing.map((field) => MISSING_LABELS[field]).join(', ')}.
          </Text>
        ) : (
          <Text size="sm" c="green">
            All set.
          </Text>
        )}

        <Button disabled={missing.length > 0} onClick={() => navigate('/')}>
          Continue
        </Button>
      </Group>
    </Stack>
  )
}
