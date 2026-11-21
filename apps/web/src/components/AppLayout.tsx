import type { Me } from '@lol/api/schema-types'
import { AppShell, Avatar, Button, Group, Menu, Text } from '@mantine/core'
import { IconLogout, IconShieldCog, IconUser, IconUsersGroup } from '@tabler/icons-react'
import { useQueryClient } from '@tanstack/react-query'
import { Outlet, NavLink as RouterNavLink, useLocation, useNavigate } from 'react-router'
import { signOut } from '../auth-client.ts'
import { teamSlugFromPath } from '../team-path.ts'
import { StatusBadge } from './badges.tsx'
import { TeamSwitcher } from './TeamSwitcher.tsx'

function NavButton({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  const { pathname } = useLocation()
  const active = pathname.startsWith(to)
  return (
    <Button
      component={RouterNavLink}
      to={to}
      variant={active ? 'light' : 'subtle'}
      leftSection={icon}
      size="sm"
    >
      {label}
    </Button>
  )
}

export function AppLayout({ me }: { me: Me }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  // the URL names the team; `me.teamSlug` is only the fallback outside /t/:slug (e.g. /new-team)
  const slug = teamSlugFromPath(useLocation().pathname) ?? me.teamSlug
  const base = slug ? `/t/${slug}` : ''

  const logout = async () => {
    await signOut()
    queryClient.clear()
    navigate('/login', { replace: true })
  }

  return (
    <AppShell header={{ height: 56 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap={4}>
            <TeamSwitcher me={me} />
            <NavButton to={`${base}/roster`} label="Roster" icon={<IconUsersGroup size={16} />} />
            {me.role === 'captain' && (
              <NavButton to={`${base}/admin`} label="Admin" icon={<IconShieldCog size={16} />} />
            )}
          </Group>

          <Menu position="bottom-end" width={220} withinPortal>
            <Menu.Target>
              <Button variant="subtle" px="xs">
                <Group gap="xs">
                  <Avatar src={me.image} name={me.name} size="sm" color="brand" />
                  <Text size="sm" visibleFrom="xs">
                    {me.name}
                  </Text>
                </Group>
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>
                <Group justify="space-between" gap="xs">
                  <Text size="xs">{me.email}</Text>
                  <StatusBadge me={me} />
                </Group>
              </Menu.Label>
              <Menu.Divider />
              <Menu.Item leftSection={<IconUser size={16} />} onClick={() => navigate('/profile')}>
                My profile
              </Menu.Item>
              <Menu.Item leftSection={<IconLogout size={16} />} onClick={logout}>
                Log out
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </AppShell.Header>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  )
}
