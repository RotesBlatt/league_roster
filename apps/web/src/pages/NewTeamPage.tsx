import { Center } from '@mantine/core'
import { CreateTeamCard } from '../components/team/CreateTeamCard.tsx'

/**
 * `/new-team` — creating another team while already in one (the switcher links here).
 * A team-less account never needs this route: `RequireMember` shows the same card instead
 * of a layout.
 */
export function NewTeamPage() {
  return (
    <Center p="md">
      <CreateTeamCard />
    </Center>
  )
}
