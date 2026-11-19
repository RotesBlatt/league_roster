import { describe, expect, test } from 'bun:test'
import { ROLE_LABELS, ROLES } from '@lol/shared'
import { MantineProvider } from '@mantine/core'
import { render, screen } from '@testing-library/react'
import { RoleBadge, StatusBadge } from '../src/components/badges.tsx'

function ui(node: React.ReactNode) {
  return render(<MantineProvider>{node}</MantineProvider>)
}

describe('RoleBadge', () => {
  for (const role of ROLES) {
    test(`renders the human label for ${role}`, () => {
      ui(<RoleBadge role={role} />)

      expect(screen.getByText(ROLE_LABELS[role])).toBeDefined()
    })
  }

  test('uses the Mantine badge primitive', () => {
    const props = { role: 'JGL' as const }
    const { container } = ui(<RoleBadge {...props} />)

    expect(container.querySelector('[class*="mantine-Badge"]')).not.toBeNull()
  })
})

describe('StatusBadge', () => {
  test('shows a team-less account as having no team', () => {
    ui(
      <StatusBadge
        me={{
          id: '1',
          name: 'x',
          email: '',
          image: null,
          teamId: null,
          teamSlug: null,
          role: 'member',
          status: null,
        }}
      />,
    )
    expect(screen.getByText('no team')).toBeDefined()
  })

  test('shows a disabled account as disabled', () => {
    ui(
      <StatusBadge
        me={{
          id: '1',
          name: 'x',
          email: '',
          image: null,
          teamId: null,
          teamSlug: null,
          role: 'member',
          status: 'disabled',
        }}
      />,
    )
    expect(screen.getByText('disabled')).toBeDefined()
  })

  test('shows an active captain as captain', () => {
    ui(
      <StatusBadge
        me={{
          id: '1',
          name: 'x',
          email: '',
          image: null,
          teamId: null,
          teamSlug: null,
          role: 'captain',
          status: 'active',
        }}
      />,
    )
    expect(screen.getByText('captain')).toBeDefined()
  })

  test('shows an active non-captain as member', () => {
    ui(
      <StatusBadge
        me={{
          id: '1',
          name: 'x',
          email: '',
          image: null,
          teamId: null,
          teamSlug: null,
          role: 'member',
          status: 'active',
        }}
      />,
    )
    expect(screen.getByText('member')).toBeDefined()
  })

  test('disabled wins over role', () => {
    ui(
      <StatusBadge
        me={{
          id: '1',
          name: 'x',
          email: '',
          image: null,
          teamId: null,
          teamSlug: null,
          role: 'captain',
          status: 'disabled',
        }}
      />,
    )

    expect(screen.queryByText('captain')).toBeNull()
    expect(screen.getByText('disabled')).toBeDefined()
  })
})
