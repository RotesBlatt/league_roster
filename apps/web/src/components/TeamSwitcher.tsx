import type { Me } from '@lol/api/schema-types'
import { Badge, Button, Group, Menu, Text } from '@mantine/core'
import { IconChevronDown, IconPlus, IconUsersGroup } from '@tabler/icons-react'
import { useLocation, useNavigate } from 'react-router'
import { useMyTeams } from '../hooks.ts'
import { currentTeam, otherTeams } from '../team-menu.ts'
import { teamPathWithSlug, teamSlugFromPath } from '../team-path.ts'

/**
 * One account may be in several teams (multi-team.md §7.3). The header names the team in the
 * URL, the menu offers the others plus "create another" — no hidden "active team" state, the
 * URL stays the source of truth.
 */
export function TeamSwitcher({ me }: { me: Me }) {
  const navigate = useNavigate()
  const teams = useMyTeams().data ?? []
  // the URL decides which team is current — `me.teamSlug` is the oldest membership, which is
  // only right until you switch, and is nothing but the fallback outside /t/:slug
  const { pathname } = useLocation()
  const slug = teamSlugFromPath(pathname) ?? me.teamSlug
  const current = currentTeam(teams, slug)
  const others = otherTeams(teams, slug)

  // while the list loads (or if it fails) the URL still knows which team this is
  const label = current?.name ?? slug ?? 'Team'

  return (
    <Menu position="bottom-start" width={260} withinPortal>
      <Menu.Target>
        <Button variant="subtle" fw={700} rightSection={<IconChevronDown size={14} />}>
          {me.role === 'captain' ? '★ ' : ''}
          {label}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {current ? (
          <Menu.Label>
            <Group justify="space-between" gap="xs">
              <Text size="xs">{current.name}</Text>
              <Badge size="xs" variant="light">
                current
              </Badge>
            </Group>
          </Menu.Label>
        ) : null}

        {others.map((team) => (
          <Menu.Item
            key={team.id}
            leftSection={<IconUsersGroup size={16} />}
            // switching is a change of tenant, not of page: keep the admin page, etc.
            onClick={() => navigate(teamPathWithSlug(pathname, team.slug))}
          >
            <Group justify="space-between" gap="md" wrap="nowrap">
              <Text size="sm">{team.name}</Text>
              {team.shortName ? (
                <Text size="xs" c="dimmed">
                  {team.shortName}
                </Text>
              ) : null}
            </Group>
          </Menu.Item>
        ))}

        <Menu.Divider />
        <Menu.Item leftSection={<IconPlus size={16} />} onClick={() => navigate('/new-team')}>
          Create another team
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}
