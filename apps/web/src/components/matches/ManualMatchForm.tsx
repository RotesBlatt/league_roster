import { ROLE_LABELS, ROLES, type Role, type TaggableKind } from '@lol/shared'
import {
  Alert,
  Button,
  Group,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core'
import { useEffect, useMemo, useState } from 'react'
import { useChampions, useCreateManualMatch, useMembers, useRoster } from '../../api/hooks.ts'
import { messageOf } from '../../api/result.ts'
import {
  emptyDraft,
  formErrors,
  type ManualPlayerDraft,
  prefillPlayers,
  roleForMember,
  toBody,
} from '../../lib/matches/manual-form.ts'

/** Inputs are narrow; the row is wide so the table can hold seven columns without scrolling. */
const CELL = 96

/**
 * Entering a scrim by hand (match-history.md §5.8, §7, §9).
 *
 * Laid out like the game itself: **one row per player, five rows, with the enemy champion beside the
 * teammate it faced**. That is the only arrangement in which a human can answer "who was I against?"
 * — a separate list of opponents cannot say whose lane an entry belongs to, and the games list needs
 * exactly that to fill its lane-opponent column.
 *
 * The roster arrives prefilled, each row with that player's role, because a scrim lineup *is* the
 * roster nine times out of ten; the role stays a normal select, since a swap is exactly what happens
 * in practice. Rows nobody touches are not submitted, so a 4v5 scrim saves fine.
 *
 * Rules are not re-implemented: `formErrors` runs the API's own `validateManualMatch`, and the errors
 * appear after the first submit attempt rather than while typing.
 */
export function ManualMatchForm({
  opened,
  onClose,
  slug,
}: {
  opened: boolean
  onClose: () => void
  slug: string
}) {
  const members = useMembers(slug, opened)
  const roster = useRoster(slug)
  const champions = useChampions()
  const create = useCreateManualMatch(slug)

  // **memoised**, because this array used to be rebuilt on every render: it was in the effect's
  // dependency list, so the effect re-fired every render, set state, and the page died with
  // "Maximum update depth exceeded". One stable identity per response is the first half of the fix.
  const rosterData = roster.data
  const rosterPeople = useMemo(
    () => (rosterData ?? []).map((entry) => ({ userId: entry.userId, role: entry.role })),
    [rosterData],
  )

  // the modal unmounts its children when closed, so this initialises freshly on every open
  const [draft, setDraft] = useState(() => emptyDraft(new Date(), rosterPeople))
  const [pristine, setPristine] = useState(true)
  const [attempted, setAttempted] = useState(false)

  // The roster usually arrives after the first render: fill the rows in once it does, and only while
  // nobody has touched them. The second half of the fix is `prefillPlayers` — it returns the *same*
  // array when there is nothing to do, so this `setState` is a no-op and cannot feed itself.
  useEffect(() => {
    if (!pristine) return
    setDraft((current) => {
      const players = prefillPlayers(current.players, rosterPeople)
      return players === current.players ? current : { ...current, players }
    })
  }, [rosterPeople, pristine])

  const errors = formErrors(draft)
  const memberOptions = (members.data ?? []).map((member) => ({
    value: member.id,
    label: member.name,
  }))
  const championOptions = (champions.data?.champions ?? []).map((champion) => ({
    value: String(champion.championId),
    label: champion.name,
  }))

  const setPlayer = (id: string, patch: Partial<ManualPlayerDraft>) => {
    setPristine(false)
    setDraft((current) => ({
      ...current,
      players: current.players.map((player) =>
        player.id === id ? { ...player, ...patch } : player,
      ),
    }))
  }

  const submit = () => {
    setAttempted(true)
    if (errors.length > 0) return

    create.mutate(toBody(draft), {
      onSuccess: () => {
        setDraft(emptyDraft(new Date(), rosterPeople))
        setPristine(true)
        setAttempted(false)
        onClose()
      },
    })
  }

  const close = () => {
    setAttempted(false)
    onClose()
  }

  const shownErrors = attempted ? errors : []
  const serverError = create.isError ? messageOf(create.error) : null

  return (
    <Modal opened={opened} onClose={close} title="Enter a game" size="min(1200px, 96vw)" centered>
      <Stack gap="sm">
        <Group align="flex-end" gap="sm" wrap="wrap">
          <TextInput
            type="datetime-local"
            label="Played at"
            value={draft.playedAt}
            onChange={(event) =>
              setDraft((current) => ({ ...current, playedAt: event.currentTarget.value }))
            }
          />
          <Select
            label="Kind"
            w={150}
            value={draft.kind}
            allowDeselect={false}
            onChange={(value) =>
              value
                ? setDraft((current) => ({ ...current, kind: value as TaggableKind }))
                : undefined
            }
            data={[
              { value: 'scrim', label: 'Scrim' },
              { value: 'tournament', label: 'Tournament' },
              { value: 'custom', label: 'Custom' },
            ]}
          />
          <Stack gap={4}>
            <Text size="sm">Result</Text>
            <SegmentedControl
              value={draft.win ? 'win' : 'loss'}
              onChange={(value) => setDraft((current) => ({ ...current, win: value === 'win' }))}
              data={[
                { value: 'win', label: 'Win' },
                { value: 'loss', label: 'Loss' },
              ]}
            />
          </Stack>
        </Group>

        <Table withTableBorder withColumnBorders verticalSpacing="xs" fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Player</Table.Th>
              <Table.Th>Champion</Table.Th>
              <Table.Th>Role</Table.Th>
              <Table.Th>K</Table.Th>
              <Table.Th>D</Table.Th>
              <Table.Th>A</Table.Th>
              {/* beside the player: this is the lane opponent the games list will show (§7) */}
              <Table.Th>Opponent</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {draft.players.map((player) => (
              <Table.Tr key={player.id}>
                <Table.Td>
                  <Select
                    placeholder="Pick a player"
                    searchable
                    value={player.userId || null}
                    data={memberOptions}
                    onChange={(value) =>
                      // picking a teammate brings their lane with them; still editable below
                      setPlayer(player.id, {
                        userId: value ?? '',
                        role: value ? roleForMember(rosterPeople, value) : '',
                      })
                    }
                  />
                </Table.Td>
                <Table.Td>
                  <Select
                    placeholder="Champion"
                    searchable
                    value={player.championId || null}
                    data={championOptions}
                    onChange={(value) => setPlayer(player.id, { championId: value ?? '' })}
                  />
                </Table.Td>
                <Table.Td w={130}>
                  <Select
                    clearable
                    placeholder="–"
                    value={player.role || null}
                    data={ROLES.map((role: Role) => ({ value: role, label: ROLE_LABELS[role] }))}
                    onChange={(value) => setPlayer(player.id, { role: value ?? '' })}
                  />
                </Table.Td>
                {(['kills', 'deaths', 'assists'] as const).map((field) => (
                  <Table.Td key={field} w={CELL}>
                    <TextInput
                      aria-label={field}
                      value={player[field]}
                      onChange={(event) =>
                        setPlayer(player.id, { [field]: event.currentTarget.value })
                      }
                    />
                  </Table.Td>
                ))}
                <Table.Td>
                  <Select
                    placeholder="Champion"
                    searchable
                    clearable
                    value={player.opponentChampionId || null}
                    data={championOptions}
                    onChange={(value) => setPlayer(player.id, { opponentChampionId: value ?? '' })}
                  />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>

        <Text size="xs" c="dimmed">
          Rows nobody touched are not saved — a scrim can be four against five.
        </Text>

        <Textarea
          label="Note"
          autosize
          minRows={2}
          value={draft.note}
          onChange={(event) =>
            setDraft((current) => ({ ...current, note: event.currentTarget.value }))
          }
        />

        {shownErrors.length > 0 ? (
          <Alert color="red" title="Not saved yet">
            {/* every reason at once, straight from the server's own validator */}
            <Stack gap={2}>
              {shownErrors.map((error) => (
                <Text key={error} size="sm">
                  {error}
                </Text>
              ))}
            </Stack>
          </Alert>
        ) : null}

        {serverError ? (
          <Alert color="red" title="The server refused it">
            {serverError}
          </Alert>
        ) : null}

        <Group justify="flex-end">
          <Button variant="default" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit} loading={create.isPending}>
            Save game
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
