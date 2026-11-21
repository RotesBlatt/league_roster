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
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { useState } from 'react'
import { useParams } from 'react-router'
import { RoleBadge, UnverifiedBadge } from '../components/badges.tsx'
import {
  useAddRosterEntry,
  useMe,
  useMembers,
  useRemoveRosterEntry,
  useRoster,
  useUpdateRosterEntry,
} from '../hooks.ts'

const roleData = ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }))

/**
 * The roster is a **join**, and this page is the place it shows: the name and the main account come
 * from the player, the note / active flag / position override from the captain
 * (player-profiles.md §2).
 *
 * There is no name field and no Riot ID field here, on purpose. A captain who could edit them would
 * be editing somebody else's profile — the split exists so that the page cannot even offer it.
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

  const [opened, setOpened] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [roleOverride, setRoleOverride] = useState<Role | null>(null)

  const rows = roster.data ?? []
  // only members who are not on the roster yet — you cannot add the same person twice
  const pickable = (members.data ?? [])
    .filter((member) => !rows.some((row) => row.userId === member.id))
    .map((member) => ({ value: member.id, label: member.name }))

  const onError = (error: Error) => notifications.show({ message: error.message, color: 'red' })

  const openAdd = () => {
    setUserId(null)
    setNote('')
    setRoleOverride(null)
    setOpened(true)
  }

  const submitAdd = () => {
    if (!userId) return
    add.mutate(
      { userId, note: note || null, roleOverride },
      {
        onSuccess: () => {
          setOpened(false)
          notifications.show({ message: 'Added to the roster', color: 'brand' })
        },
        onError,
      },
    )
  }

  const setActive = (entry: RosterEntryDto, isActive: boolean) =>
    update.mutate({ id: entry.id, isActive }, { onError })

  const removeEntry = (entry: RosterEntryDto) =>
    remove.mutate(entry.id, {
      onSuccess: () => notifications.show({ message: 'Removed from the roster', color: 'brand' }),
      onError,
    })

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
        <Table.ScrollContainer minWidth={720}>
          <Table verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Player</Table.Th>
                <Table.Th>Role</Table.Th>
                <Table.Th>Main account</Table.Th>
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
                    {entry.mainAccount ? (
                      <Group gap="xs">
                        <Text size="sm">{`${entry.mainAccount.gameName}#${entry.mainAccount.tagLine}`}</Text>
                        <UnverifiedBadge verifiedAt={entry.mainAccount.verifiedAt} />
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
                        onChange={(event) => setActive(entry, event.currentTarget.checked)}
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
                      <ActionIcon
                        color="red"
                        variant="subtle"
                        aria-label={`Remove ${entry.displayName}`}
                        onClick={() => removeEntry(entry)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Modal opened={opened} onClose={() => setOpened(false)} title="Add a team member">
        <Stack>
          <Select
            label="Member"
            description="Only people who already joined this team can be added"
            data={pickable}
            value={userId}
            onChange={setUserId}
            searchable
            nothingFoundMessage="Everyone on the team is already on the roster"
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
    </Stack>
  )
}
