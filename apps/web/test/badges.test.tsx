import { describe, expect, test } from 'bun:test'
import { ROLE_LABELS, ROLES } from '@lol/shared'
import { MantineProvider } from '@mantine/core'
import { render, screen } from '@testing-library/react'
import { MainBadge, RoleBadge, StatusBadge, UnverifiedBadge } from '../src/components/Badges.tsx'

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

describe('MainBadge', () => {
  test('marks the account used for the real games', () => {
    ui(<MainBadge />)

    expect(screen.getByText('main')).toBeDefined()
  })
})

describe('UnverifiedBadge', () => {
  test('an account never checked against Riot is shown as unverified, not as broken', () => {
    ui(<UnverifiedBadge verifiedAt={null} />)

    expect(screen.getByText('unverified')).toBeDefined()
  })

  test('a checked account carries no badge at all', () => {
    // Mantine injects its styles into the container, so "renders nothing" is asserted on the
    // badge element, not on textContent
    const { container } = ui(<UnverifiedBadge verifiedAt={1_700_000_000_000} />)

    expect(screen.queryByText('unverified')).toBeNull()
    expect(container.querySelector('[class*="mantine-Badge"]')).toBeNull()
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

  test('an active membership needs no badge at all', () => {
    // "captain" is per team now (the switcher says which), so a role badge next to the account
    // name says nothing. "member" said even less.
    const { container } = ui(
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

    expect(container.querySelector('[class*="mantine-Badge"]')).toBeNull()
  })

  test('disabled still shows, whatever the role', () => {
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
