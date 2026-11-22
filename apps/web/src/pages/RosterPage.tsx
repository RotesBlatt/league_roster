import type { RosterEntryDto } from '@lol/api/schema-types'
import type { Role } from '@lol/shared'
import { ROLE_LABELS, ROLES } from '@lol/shared'
import {
  ActionIcon,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import { useState } from 'react'
import { useParams } from 'react-router'
import {
  useAddRosterEntry,
  useMe,
  useMembers,
  useRemoveRosterEntry,
  useRoster,
  useUpdateRosterEntry,
} from '../api/hooks.ts'
import { MainBadge, RankBadges, RoleBadge, UnverifiedBadge } from '../components/badges.tsx'
import { defaultAccountId, accountOptions as optionsFor, pickableMembers } from '../roster-form.ts'

const roleData = ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }))

/**
 * The roster is a **join**, and this page is where it shows: name and accounts come from the
 * player, the note / active flag / position override / **account used for this team** from the
 * captain (player-profiles.md §2, §10).
 *
 * No name field and no Riot ID field here, on purpose: a captain who could edit them would be
 * editing somebody else's profile.
 */
export function RosterPage() {
  const { slug = '' } = useParams()
  const me = useMe()
  const roster = useRoster(slug)
  const members = useMembers(slug)
  const add = useAddRosterEntry(slug)
  const update = useUpdateRosterEntry(slug)
  const remove = useRemoveRosterEntry(slug)
  const isCaptain = me.data?.role === 'captain'

  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<RosterEntryDto | null>(null)
  const [confirming, setConfirming] = useState<RosterEntryDto | null>(null)

  const [userId, setUserId] = useState<string | null>(null)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [roleOverride, setRoleOverride] = useState<Role | null>(null)
  const [isActive, setIsActive] = useState(true)

  const rows = roster.data ?? []
  const memberList = members.data ?? []
  const memberOf = (id: string) => memberList.find((member) => member.id === id)

  const pickable = pickableMembers(memberList, rows).map((member) => ({
    value: member.id,
    label: member.name,
  }))

  /** The accounts the captain may choose from — always the member's own. */
  const accountOptions = (forUserId: string | null) =>
    optionsFor(forUserId ? memberOf(forUserId) : undefined)

  const onError = (error: Error) => notifications.show({ message: error.message, color: 'red' })

  const openAdd = () => {
    setUserId(null)
    setAccountId(null)
    setNote('')
    setRoleOverride(null)
    setAdding(true)
  }

  /** Picking a member preselects his main account; the captain may choose another. */
  const pickMember = (id: string | null) => {
    setUserId(id)
    setAccountId(defaultAccountId(id ? memberOf(id) : undefined))
  }

  const openEdit = (entry: RosterEntryDto) => {
    setEditing(entry)
    setAccountId(entry.account?.id ?? null)
    setNote(entry.note ?? '')
    setRoleOverride(entry.role)
    setIsActive(entry.isActive)
  }

  const submitAdd = () => {
    if (!userId) return
    add.mutate(
      { userId, accountId, note: note || null, roleOverride },
      {
        onSuccess: () => {
          setAdding(false)
          notifications.show({ message: 'Added to the roster', color: 'brand' })
        },
        onError,
      },
    )
  }

  const submitEdit = () => {
    if (!editing) return
    update.mutate(
      { id: editing.id, accountId, note: note || null, roleOverride, isActive },
      {
        onSuccess: () => {
          setEditing(null)
          notifications.show({ message: 'Roster entry updated', color: 'brand' })
        },
        onError,
      },
    )
  }

  const confirmRemove = () => {
    if (!confirming) return
    remove.mutate(confirming.id, {
      onSuccess: () => {
        setConfirming(null)
        notifications.show({ message: 'Removed from the roster', color: 'brand' })
      },
      onError,
    })
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>Roster</Title>
        {isCaptain && (
          <Button leftSection={<IconPlus size={16} />} onClick={openAdd}>
            Add from team
          </Button>
        )}
      </Group>

      {rows.length === 0 ? (
        <Text c="dimmed">
          Nobody on the roster yet. Members join the team with an invite link; then add them here.
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={820}>
          <Table verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Player</Table.Th>
                <Table.Th>Role</Table.Th>
                <Table.Th>Account</Table.Th>
                <Table.Th>Note</Table.Th>
                <Table.Th>Active</Table.Th>
                {isCaptain && <Table.Th />}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((entry) => (
                <Table.Tr key={entry.id}>
                  <Table.Td>
                    <Text fw={500}>{entry.displayName}</Text>
                  </Table.Td>
                  <Table.Td>
                    {entry.role ? (
                      <RoleBadge role={entry.role} />
                    ) : (
                      <Text size="sm" c="dimmed">
                        unassigned
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {entry.account ? (
                      <Group gap="xs">
                        <Text size="sm">{`${entry.account.gameName}#${entry.account.tagLine}`}</Text>
                        {entry.account.isMain ? <MainBadge /> : null}
                        <UnverifiedBadge verifiedAt={entry.account.verifiedAt} />
                        {/* "if possible": the snapshot of *this* team's account, queue included */}
                        <RankBadges ranks={entry.account.ranks} />
                      </Group>
                    ) : (
                      <Text size="sm" c="dimmed">
                        no account
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c={entry.note ? undefined : 'dimmed'}>
                      {entry.note ?? '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {isCaptain ? (
                      <Switch
                        checked={entry.isActive}
                        onChange={(event) =>
                          update.mutate(
                            { id: entry.id, isActive: event.currentTarget.checked },
                            { onError },
                          )
                        }
                        aria-label={`${entry.displayName} active`}
                      />
                    ) : (
                      <Text size="sm" c="dimmed">
                        {entry.isActive ? 'yes' : 'no'}
                      </Text>
                    )}
                  </Table.Td>
                  {isCaptain && (
                    <Table.Td align="right">
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <ActionIcon
                          variant="subtle"
                          aria-label={`Edit ${entry.displayName}`}
                          onClick={() => openEdit(entry)}
                        >
                          <IconPencil size={16} />
                        </ActionIcon>
                        <ActionIcon
                          color="red"
                          variant="subtle"
                          aria-label={`Remove ${entry.displayName}`}
                          onClick={() => setConfirming(entry)}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Modal opened={adding} onClose={() => setAdding(false)} title="Add a team member">
        <Stack>
          <Select
            label="Member"
            description="Only people who already joined this team can be added"
            data={pickable}
            value={userId}
            onChange={pickMember}
            searchable
            nothingFoundMessage="Everyone on the team is already on the roster"
          />
          <Select
            label="Account for this team"
            description="Defaults to his main — pick another if he plays on a different account here"
            data={accountOptions(userId)}
            value={accountId}
            onChange={setAccountId}
            clearable
            placeholder={userId ? 'His main account' : 'Pick a member first'}
            disabled={!userId}
          />
          <Select
            label="Role override"
            description="Optional — blank uses the position the player stated"
            data={roleData}
            value={roleOverride}
            onChange={(value) => setRoleOverride(value as Role | null)}
            clearable
          />
          <TextInput
            label="Note"
            placeholder="sub, coach, …"
            value={note}
            onChange={(event) => setNote(event.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button onClick={submitAdd} disabled={!userId} loading={add.isPending}>
              Add
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={editing !== null} onClose={() => setEditing(null)} title="Edit roster entry">
        <Stack>
          <Select
            label="Account for this team"
            description="Blank follows his main account"
            data={accountOptions(editing?.userId ?? null)}
            value={accountId}
            onChange={setAccountId}
            clearable
            placeholder="His main account"
          />
          <Select
            label="Role override"
            description="Blank uses the position the player stated"
            data={roleData}
            value={roleOverride}
            onChange={(value) => setRoleOverride(value as Role | null)}
            clearable
          />
          <TextInput
            label="Note"
            value={note}
            onChange={(event) => setNote(event.currentTarget.value)}
          />
          <Switch
            label="On the roster"
            checked={isActive}
            onChange={(event) => setIsActive(event.currentTarget.checked)}
          />
          <Group justify="flex-end">
            <Button onClick={submitEdit} loading={update.isPending}>
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={confirming !== null}
        onClose={() => setConfirming(null)}
        title="Remove from the roster?"
      >
        <Stack>
          <Text size="sm">
            {confirming?.displayName} will be removed from this team’s roster. His profile and
            accounts stay untouched.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button color="red" onClick={confirmRemove} loading={remove.isPending}>
              Remove from roster
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
