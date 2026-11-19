import type { PlayerDto } from '@lol/api/schema-types'
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
  Textarea,
  TextInput,
  Title,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams } from 'react-router'
import { api, unwrap } from '../api.ts'
import { RoleBadge } from '../components/badges.tsx'
import { useMe, usePlayers } from '../hooks.ts'

const roleData = ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }))

type FormValues = {
  displayName: string
  role: Role
  riotGameName: string
  riotTagLine: string
  note: string
  isActive: boolean
}

const emptyValues: FormValues = {
  displayName: '',
  role: 'TOP',
  riotGameName: '',
  riotTagLine: '',
  note: '',
  isActive: true,
}

export function RosterPage() {
  const { slug = '' } = useParams()
  const me = useMe()
  const players = usePlayers(slug)
  const queryClient = useQueryClient()
  const isCaptain = me.data?.role === 'captain'

  const [opened, setOpened] = useState(false)
  const [editing, setEditing] = useState<PlayerDto | null>(null)

  const form = useForm<FormValues>({
    initialValues: emptyValues,
    validate: {
      displayName: (value) => (value.trim().length > 0 ? null : 'Name is required'),
    },
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['players', slug] })

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      editing
        ? unwrap(api.teams({ slug }).players({ id: editing.id }).patch(values))
        : unwrap(api.teams({ slug }).players.post(values)),
    onSuccess: () => {
      void invalidate()
      notifications.show({ message: editing ? 'Player updated' : 'Player added', color: 'brand' })
      setOpened(false)
    },
    onError: (error) => notifications.show({ message: error.message, color: 'red' }),
  })

  const remove = useMutation({
    mutationFn: (id: string) => unwrap(api.teams({ slug }).players({ id }).delete()),
    onSuccess: () => {
      void invalidate()
      notifications.show({ message: 'Player removed', color: 'brand' })
    },
    onError: (error) => notifications.show({ message: error.message, color: 'red' }),
  })

  const openCreate = () => {
    setEditing(null)
    form.setValues(emptyValues)
    form.resetDirty()
    setOpened(true)
  }

  const openEdit = (player: PlayerDto) => {
    setEditing(player)
    form.setValues({
      displayName: player.displayName,
      role: player.role,
      riotGameName: player.riotGameName ?? '',
      riotTagLine: player.riotTagLine ?? '',
      note: player.note ?? '',
      isActive: player.isActive,
    })
    setOpened(true)
  }

  const rows = players.data ?? []

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>Roster</Title>
        {isCaptain && (
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
            Add player
          </Button>
        )}
      </Group>

      <Table.ScrollContainer minWidth={640}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={110}>Role</Table.Th>
              <Table.Th>Player</Table.Th>
              <Table.Th>Riot ID</Table.Th>
              <Table.Th>Note</Table.Th>
              <Table.Th w={90}>Status</Table.Th>
              {isCaptain && <Table.Th w={96} />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((player) => (
              <Table.Tr key={player.id} opacity={player.isActive ? 1 : 0.55}>
                <Table.Td>
                  <RoleBadge role={player.role} />
                </Table.Td>
                <Table.Td fw={600}>{player.displayName}</Table.Td>
                <Table.Td>
                  <Text size="sm" c={player.riotGameName ? undefined : 'dimmed'}>
                    {player.riotGameName
                      ? `${player.riotGameName}#${player.riotTagLine ?? ''}`
                      : 'not linked'}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed" lineClamp={1}>
                    {player.note ?? ''}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c={player.isActive ? 'brand' : 'dimmed'}>
                    {player.isActive ? 'active' : 'inactive'}
                  </Text>
                </Table.Td>
                {isCaptain && (
                  <Table.Td>
                    <Group gap={4} justify="flex-end">
                      <ActionIcon
                        variant="subtle"
                        aria-label="Edit"
                        onClick={() => openEdit(player)}
                      >
                        <IconPencil size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        aria-label="Delete"
                        onClick={() => {
                          if (confirm(`Remove ${player.displayName} from the roster?`)) {
                            remove.mutate(player.id)
                          }
                        }}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
            {rows.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={isCaptain ? 6 : 5}>
                  <Text c="dimmed" ta="center" py="md">
                    No players yet.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title={editing ? `Edit ${editing.displayName}` : 'Add player'}
        centered
      >
        <form onSubmit={form.onSubmit((values) => save.mutate(values))}>
          <Stack>
            <TextInput
              label="Name"
              placeholder="Faker"
              withAsterisk
              {...form.getInputProps('displayName')}
            />
            <Select
              label="Role"
              data={roleData}
              allowDeselect={false}
              {...form.getInputProps('role')}
            />
            <Group grow>
              <TextInput
                label="Riot name"
                placeholder="Hide on bush"
                {...form.getInputProps('riotGameName')}
              />
              <TextInput label="Tag" placeholder="EUW" {...form.getInputProps('riotTagLine')} />
            </Group>
            <Textarea
              label="Note"
              autosize
              minRows={2}
              maxLength={500}
              {...form.getInputProps('note')}
            />
            <Switch
              label="On the active roster"
              {...form.getInputProps('isActive', { type: 'checkbox' })}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setOpened(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={save.isPending}>
                Save
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  )
}
