import { ROLE_LABELS, ROLES, type TaggableKind } from '@lol/shared'
import {
  ActionIcon,
  Alert,
  Button,
  Divider,
  Group,
  Modal,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { useState } from 'react'
import { useChampions, useCreateManualMatch, useMembers } from '../../api/hooks.ts'
import { messageOf } from '../../api/result.ts'
import {
  emptyDraft,
  emptyOpponent,
  emptyPlayer,
  formErrors,
  type ManualPlayerDraft,
  toBody,
} from '../../lib/matches/manual-form.ts'

/**
 * Entering a scrim by hand (match-history.md §5.8, §9).
 *
 * The form is deliberately **one screen with no wizard**: it is filled in minutes after a scrim block,
 * usually late, sometimes half-remembered. So only the date, a result and one player with a champion
 * are required; roles, KDA, opponents and the note are there for whoever has the patience, and every
 * one of them may stay empty.
 *
 * The rules are not re-implemented here: `formErrors` runs the API's own `validateManualMatch`, so the
 * form cannot accept something the route refuses. The errors appear **after the first submit attempt**,
 * not while typing — a form that turns red as you fill it in reads as hostile.
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
  const champions = useChampions()
  const create = useCreateManualMatch(slug)

  const [draft, setDraft] = useState(emptyDraft)
  const [attempted, setAttempted] = useState(false)

  const errors = formErrors(draft)
  const memberOptions = (members.data ?? []).map((member) => ({
    value: member.id,
    label: member.name,
  }))
  const championOptions = (champions.data?.champions ?? []).map((champion) => ({
    value: String(champion.championId),
    label: champion.name,
  }))

  const setPlayer = (index: number, patch: Partial<ManualPlayerDraft>) =>
    setDraft((current) => ({
      ...current,
      players: current.players.map((player, at) =>
        at === index ? { ...player, ...patch } : player,
      ),
    }))

  const submit = () => {
    setAttempted(true)
    if (errors.length > 0) return

    create.mutate(toBody(draft), {
      onSuccess: () => {
        setDraft(emptyDraft())
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
    <Modal opened={opened} onClose={close} title="Enter a game" size="xl" centered>
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

        {draft.players.map((player, index) => (
          // keyed by the row's own id, so removing one in the middle does not re-key the rest
          <Paper key={player.id} withBorder p="xs">
            <Group align="flex-end" gap="xs" wrap="wrap">
              <Select
                label="Player"
                w={170}
                searchable
                value={player.userId || null}
                data={memberOptions}
                onChange={(value) => setPlayer(index, { userId: value ?? '' })}
              />
              <Select
                label="Champion"
                w={170}
                searchable
                value={player.championId || null}
                data={championOptions}
                onChange={(value) => setPlayer(index, { championId: value ?? '' })}
              />
              <Select
                label="Role"
                w={110}
                clearable
                value={player.role || null}
                data={ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }))}
                onChange={(value) => setPlayer(index, { role: value ?? '' })}
              />
              {(['kills', 'deaths', 'assists'] as const).map((field) => (
                <TextInput
                  key={field}
                  label={field.charAt(0).toUpperCase()}
                  w={56}
                  value={player[field]}
                  onChange={(event) => setPlayer(index, { [field]: event.currentTarget.value })}
                />
              ))}
              {draft.players.length > 1 ? (
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label="Remove player"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      players: current.players.filter((_unused, at) => at !== index),
                    }))
                  }
                >
                  <IconTrash size={16} />
                </ActionIcon>
              ) : null}
            </Group>
          </Paper>
        ))}

        <Group>
          <Button
            variant="subtle"
            size="xs"
            leftSection={<IconPlus size={14} />}
            disabled={draft.players.length >= 5}
            onClick={() =>
              setDraft((current) => ({ ...current, players: [...current.players, emptyPlayer()] }))
            }
          >
            Add player
          </Button>
        </Group>

        <Divider label="Opponents — champions only, optional" labelPosition="left" />

        {draft.opponents.map((opponent, index) => (
          <Group key={opponent.id} align="flex-end" gap="xs">
            <Select
              label={`Opponent ${index + 1}`}
              w={200}
              searchable
              clearable
              value={opponent.championId || null}
              data={championOptions}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  opponents: current.opponents.map((existing) =>
                    existing.id === opponent.id
                      ? { ...existing, championId: value ?? '' }
                      : existing,
                  ),
                }))
              }
            />
            <ActionIcon
              variant="subtle"
              color="red"
              aria-label="Remove opponent"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  opponents: current.opponents.filter((existing) => existing.id !== opponent.id),
                }))
              }
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        ))}

        <Group>
          <Button
            variant="subtle"
            size="xs"
            leftSection={<IconPlus size={14} />}
            disabled={draft.opponents.length >= 5}
            onClick={() =>
              setDraft((current) => ({
                ...current,
                opponents: [...current.opponents, emptyOpponent()],
              }))
            }
          >
            Add opponent
          </Button>
        </Group>

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
