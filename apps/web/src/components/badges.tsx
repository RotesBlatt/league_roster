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

export function StatusBadge({ me }: { me: Me }) {
  // null status == no membership in any team (as opposed to 'disabled', a decision)
  if (!me.status) return <Badge color="gray">no team</Badge>
  if (me.status === 'disabled') return <Badge color="red">disabled</Badge>
  return <Badge color="brand">{me.role === 'captain' ? 'captain' : 'member'}</Badge>
}
