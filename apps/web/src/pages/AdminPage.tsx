import {
  Badge,
  Button,
  Card,
  CopyButton,
  Group,
  NumberInput,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { IconCheck, IconCopy, IconPlus } from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Navigate, useParams } from 'react-router'
import { api, unwrap } from '../api.ts'
import { TeamSettingsCard } from '../components/TeamSettingsCard.tsx'
import { useInvites, useMe, useMembers, useMyTeams } from '../hooks.ts'

type MemberPatch = {
  role?: 'captain' | 'member'
  status?: 'active' | 'disabled'
}

export function AdminPage() {
  const { slug = '' } = useParams()
  const me = useMe()
  const isCaptain = me.data?.role === 'captain'
  const invites = useInvites(slug, isCaptain)
  const members = useMembers(slug, isCaptain)
  // the card renames the team the URL names, not "my" team: `me` is only the oldest membership
  const team = useMyTeams().data?.find((row) => row.slug === slug)
  const queryClient = useQueryClient()

  const form = useForm({
    initialValues: { note: '', maxUses: 1, expiresInDays: 7 },
  })

  const createInvite = useMutation({
    mutationFn: (values: typeof form.values) =>
      unwrap(
        api.teams({ slug }).invites.post({
          note: values.note || undefined,
          maxUses: values.maxUses,
          expiresInDays: values.expiresInDays || undefined,
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['invites', slug] })
      form.setValues({ note: '', maxUses: 1, expiresInDays: 7 })
      notifications.show({ message: 'Invite created', color: 'brand' })
    },
    onError: (error) => notifications.show({ message: error.message, color: 'red' }),
  })

  const revoke = useMutation({
    mutationFn: (id: string) => unwrap(api.teams({ slug }).invites({ id }).revoke.post()),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['invites', slug] }),
    onError: (error) => notifications.show({ message: error.message, color: 'red' }),
  })

  const updateMember = useMutation({
    mutationFn: ({ id, ...patch }: { id: string } & MemberPatch) =>
      unwrap(api.teams({ slug }).members({ id }).patch(patch)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['members', slug] })
      notifications.show({ message: 'Member updated', color: 'brand' })
    },
    onError: (error) => notifications.show({ message: error.message, color: 'red' }),
  })

  if (!isCaptain) return <Navigate to="/roster" replace />

  return (
    <Stack gap="lg">
      <Title order={2}>Admin</Title>

      {/* keyed by id: the form seeds its state once, so another team must not reuse it */}
      {team ? <TeamSettingsCard key={team.id} team={team} /> : null}

      <Card>
        <Stack>
          <Title order={4}>Invites</Title>
          <form onSubmit={form.onSubmit((values) => createInvite.mutate(values))}>
            <Group align="flex-end" wrap="wrap">
              <TextInput
                label="Note"
                placeholder="for Julius"
                flex={1}
                miw={160}
                {...form.getInputProps('note')}
              />
              <NumberInput
                label="Max uses"
                min={1}
                max={100}
                w={110}
                {...form.getInputProps('maxUses')}
              />
              <NumberInput
                label="Expires in (days)"
                min={1}
                max={365}
                w={150}
                {...form.getInputProps('expiresInDays')}
              />
              <Button
                type="submit"
                leftSection={<IconPlus size={16} />}
                loading={createInvite.isPending}
              >
                Create
              </Button>
            </Group>
          </form>

          <Table.ScrollContainer minWidth={620}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Link</Table.Th>
                  <Table.Th>Note</Table.Th>
                  <Table.Th w={90}>Uses</Table.Th>
                  <Table.Th w={160}>Expires</Table.Th>
                  <Table.Th w={110}>State</Table.Th>
                  <Table.Th w={140} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(invites.data ?? []).map((invite) => {
                  const expired = invite.expiresAt !== null && invite.expiresAt < Date.now()
                  const state = invite.revokedAt ? 'revoked' : expired ? 'expired' : 'active'
                  return (
                    <Table.Tr key={invite.id}>
                      <Table.Td>
                        <Text size="sm" ff="monospace">
                          {invite.path}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">
                          {invite.note ?? '—'}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        {invite.uses}/{invite.maxUses}
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">
                          {invite.expiresAt
                            ? new Date(invite.expiresAt).toLocaleDateString()
                            : 'never'}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge color={state === 'active' ? 'brand' : 'gray'}>{state}</Badge>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4} justify="flex-end">
                          <CopyButton value={`${window.location.origin}${invite.path}`}>
                            {({ copied, copy }) => (
                              <Button
                                size="xs"
                                variant="light"
                                onClick={copy}
                                leftSection={
                                  copied ? <IconCheck size={14} /> : <IconCopy size={14} />
                                }
                              >
                                {copied ? 'Copied' : 'Copy'}
                              </Button>
                            )}
                          </CopyButton>
                          {state === 'active' && (
                            <Button
                              size="xs"
                              variant="subtle"
                              color="red"
                              onClick={() => revoke.mutate(invite.id)}
                            >
                              Revoke
                            </Button>
                          )}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
                {(invites.data ?? []).length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={6}>
                      <Text c="dimmed" ta="center" py="md">
                        No invites yet.
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Stack>
      </Card>

      <Card>
        <Stack>
          <Title order={4}>Members</Title>
          <Table.ScrollContainer minWidth={640}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Role</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Joined</Table.Th>
                  <Table.Th w={230} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(members.data ?? []).map((member) => (
                  <Table.Tr key={member.id}>
                    <Table.Td>
                      <Text size="sm" fw={member.role === 'captain' ? 700 : 400}>
                        {member.name}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {member.email}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={member.role === 'captain' ? 'yellow' : 'gray'}>
                        {member.role}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={member.status === 'active' ? 'brand' : 'red'}>
                        {member.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {new Date(member.createdAt).toLocaleDateString()}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end">
                        {member.status === 'disabled' && (
                          <Button
                            size="xs"
                            variant="light"
                            onClick={() => updateMember.mutate({ id: member.id, status: 'active' })}
                          >
                            Re-enable
                          </Button>
                        )}
                        <Button
                          size="xs"
                          variant="subtle"
                          onClick={() =>
                            updateMember.mutate({
                              id: member.id,
                              role: member.role === 'captain' ? 'member' : 'captain',
                            })
                          }
                        >
                          {member.role === 'captain' ? 'Demote' : 'Make captain'}
                        </Button>
                        {member.status === 'active' && member.id !== me.data?.id && (
                          <Button
                            size="xs"
                            variant="subtle"
                            color="red"
                            onClick={() =>
                              updateMember.mutate({ id: member.id, status: 'disabled' })
                            }
                          >
                            Disable
                          </Button>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Stack>
      </Card>
    </Stack>
  )
}
