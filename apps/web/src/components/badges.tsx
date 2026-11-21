import type { Me } from '@lol/api/schema-types'
import type { Role } from '@lol/shared'
import { ROLE_LABELS } from '@lol/shared'
import { Badge } from '@mantine/core'

const COLORS: Record<Role, string> = {
  TOP: 'red',
  JGL: 'green',
  MID: 'blue',
  ADC: 'orange',
  SUP: 'grape',
}

export function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge color={COLORS[role]} variant="light" w={64}>
      {ROLE_LABELS[role]}
    </Badge>
  )
}

/** Marks the one account used for the real Prime League games. */
export function MainBadge() {
  return (
    <Badge color="brand" variant="filled">
      main
    </Badge>
  )
}

/**
 * "Unverified" is a state, not an error: the account was typed in but never checked against Riot
 * (docs/ideas/integrations/riot-api.md §5). A checked account shows nothing — a second badge
 * saying "verified" would be noise on every row.
 */
export function UnverifiedBadge({ verifiedAt }: { verifiedAt: number | null }) {
  if (verifiedAt !== null) return null
  return (
    <Badge color="yellow" variant="light">
      unverified
    </Badge>
  )
}

/**
 * Only the states that are worth a word. An active membership is the normal case, and "captain"
 * is per team — the switcher already says which team you lead, so a role badge in the account
 * menu would be noise that is also easy to read as a global permission.
 */
export function StatusBadge({ me }: { me: Me }) {
  // null status == no membership in any team (as opposed to 'disabled', a decision)
  if (!me.status) return <Badge color="gray">no team</Badge>
  if (me.status === 'disabled') return <Badge color="red">disabled</Badge>
  return null
}
