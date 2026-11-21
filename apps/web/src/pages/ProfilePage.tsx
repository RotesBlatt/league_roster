import { Stack, Text, Title } from '@mantine/core'
import { AccountsSection, ProfileSection } from '../components/profile-sections.tsx'

/**
 * The player's own page: edit what `/welcome` asked for the first time, any time.
 * The sections are shared with the first-login page — one form, two entry points.
 */
export function ProfilePage() {
  return (
    <Stack gap="lg" maw={640} mx="auto" w="100%">
      <div>
        <Title order={2}>My profile</Title>
        <Text size="sm" c="dimmed">
          This is yours — the roster shows it, so edit it here and nowhere else.
        </Text>
      </div>

      <ProfileSection />
      <AccountsSection />
    </Stack>
  )
}
