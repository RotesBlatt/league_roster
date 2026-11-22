import type { PlannerTemplateDto, PlannerWeekDto } from '@lol/api/schema-types'
import { Badge, Button, Group, Loader, Stack, Tabs, Text, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconArrowBackUp } from '@tabler/icons-react'
import { useState } from 'react'
import { useParams } from 'react-router'
import {
  applyGesture,
  CELLS_PER_DAY,
  type Cell,
  DAYS_PER_WEEK,
  daysFromGrid,
  formatMinute,
  type Gesture,
  type Grid,
  gridFromDays,
  SLOT_MINUTES,
  startGesture,
} from '../availability-grid.ts'
import { useMe, usePlanner, usePlannerTemplate, useRoster, useSaveWeek } from '../hooks.ts'
import {
  flattenWindows,
  initialDays,
  isProvisional,
  missingNames,
  provisionalText,
  weekLabel,
} from '../planner.ts'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

/**
 * The week planner (availability-planner.md §9).
 *
 * The page paints and lays out; it does not think. Cell ↔ interval mapping, the gesture rules and
 * "which times are playable" live in `availability-grid.ts`, `planner.ts` and `@lol/shared`, all
 * unit-tested without a DOM. What is left here is: which week is open, what the grid holds, and
 * what to send.
 *
 * Writing your own week is the only shared state this page changes, and the API refuses anything
 * else — a captain cannot repaint somebody else's Tuesday.
 */
export function WeekPlannerPage() {
  const { slug = '' } = useParams()
  const me = useMe()
  const planner = usePlanner(slug)
  const template = usePlannerTemplate(slug)
  const roster = useRoster(slug)
  const [selected, setSelected] = useState('0')

  const data = planner.data
  const weeks = data?.weeks ?? []
  const week = weeks[Number(selected)] ?? weeks[0]

  const names: Record<string, string> = {}
  for (const entry of roster.data ?? []) names[entry.userId] = entry.displayName

  if (planner.isPending || !data || !week || !template.data) return <Loader size="sm" />

  return (
    <Stack gap="lg" maw={980}>
      <Group justify="space-between" align="flex-end">
        <Title order={2}>Week planner</Title>
        <Text size="sm" c="dimmed">
          {data.timezone}
        </Text>
      </Group>

      <Tabs value={selected} onChange={(value) => setSelected(value ?? '0')}>
        <Tabs.List>
          {data.weeks.map((entry, index) => (
            <Tabs.Tab key={entry.startsOn} value={String(index)}>
              {weekLabel(entry.startsOn, data.windowStart)}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>

      {/*
        Remounted per week and per answer set, so the grid is always the server's version of what
        I said — never a merge of it with what I happened to have painted before a save landed.
      */}
      <PlannerBoard
        key={`${week.startsOn}:${week.answered.join(',')}`}
        slug={slug}
        week={week}
        template={template.data}
        meId={me.data?.id ?? ''}
        names={names}
      />
    </Stack>
  )
}

function PlannerBoard({
  slug,
  week,
  template,
  meId,
  names,
}: {
  slug: string
  week: PlannerWeekDto
  template: PlannerTemplateDto
  meId: string
  names: Record<string, string>
}) {
  const save = useSaveWeek(slug)
  const [grid, setGrid] = useState<Grid>(() => gridFromDays(initialDays(week, template, meId)))
  const [gesture, setGesture] = useState<Gesture | null>(null)
  /** The grid before the current gesture: one-step undo, because a bad drag can wipe eight hours. */
  const [before, setBefore] = useState<Grid | null>(null)
  const [dirty, setDirty] = useState(false)

  const answered = week.answered.includes(meId)
  const ranked = flattenWindows(week)
  const stillToAnswer = week.unanswered.map((userId) => names[userId] ?? '?')

  const begin = (cell: Cell) => {
    const started = startGesture(grid, cell)
    setBefore(grid)
    setGesture(started)
    setGrid(applyGesture(started, cell))
    setDirty(true)
  }

  const drag = (cell: Cell) => {
    if (!gesture) return
    setGrid(applyGesture(gesture, cell))
  }

  const undo = () => {
    if (!before) return
    setGrid(before)
    setBefore(null)
    setGesture(null)
    setDirty(true)
  }

  const onSave = () => {
    save.mutate(
      { startsOn: week.startsOn, days: daysFromGrid(grid) },
      {
        onSuccess: () => notifications.show({ message: 'Week saved', color: 'green' }),
        onError: (error: Error) => notifications.show({ message: error.message, color: 'red' }),
      },
    )
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {answered
            ? 'Your week as saved — repaint and save again to change it.'
            : 'Starting from your regular times. Nothing is saved until you save.'}
        </Text>
        <Group gap="xs">
          <Button
            variant="subtle"
            size="xs"
            leftSection={<IconArrowBackUp size={14} />}
            onClick={undo}
            disabled={!before}
          >
            Undo
          </Button>
          <Button size="sm" onClick={onSave} loading={save.isPending} disabled={!dirty}>
            Save my week
          </Button>
        </Group>
      </Group>

      <Stack gap={2} aria-label="Your availability">
        {Array.from({ length: DAYS_PER_WEEK }, (_, dayOfWeek) => (
          <Group key={DAY_KEYS[dayOfWeek]} gap={4} wrap="nowrap">
            <Text size="xs" w={32} c="dimmed">
              {DAY_LABELS[dayOfWeek]}
            </Text>
            {Array.from({ length: CELLS_PER_DAY }, (_, cell) => {
              const free = grid[dayOfWeek]?.[cell] ?? false
              const label = `${DAY_LABELS[dayOfWeek]} ${formatMinute(cell * SLOT_MINUTES)}`

              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={free}
                  aria-label={label}
                  onPointerDown={() => begin({ dayOfWeek, cell })}
                  onPointerEnter={() => drag({ dayOfWeek, cell })}
                  onPointerUp={() => setGesture(null)}
                  style={{
                    flex: 1,
                    height: 18,
                    minWidth: 6,
                    padding: 0,
                    border: 'none',
                    borderLeft: cell % 2 === 0 ? '1px solid rgba(0,0,0,0.15)' : 'none',
                    cursor: 'pointer',
                    background: free ? 'var(--mantine-color-brand-6)' : 'rgba(0,0,0,0.06)',
                  }}
                />
              )
            })}
          </Group>
        ))}
      </Stack>

      <Stack gap="xs">
        <Group gap="sm">
          <Title order={4}>Playable</Title>
          {isProvisional(week) ? (
            <Badge color="yellow" variant="light">
              provisional
            </Badge>
          ) : (
            <Badge color="green" variant="light">
              complete
            </Badge>
          )}
        </Group>

        {provisionalText(week) && (
          <Text size="sm" c="dimmed">
            {provisionalText(week)}
          </Text>
        )}

        <Text size="sm">
          <Text span fw={600}>
            Still to answer:{' '}
          </Text>
          {stillToAnswer.length > 0 ? stillToAnswer.join(', ') : 'everyone has answered'}
        </Text>

        {ranked.length === 0 ? (
          <Text size="sm" c="dimmed">
            No session is possible at four players yet. Paint more time, or wait for the others.
          </Text>
        ) : (
          ranked.slice(0, 4).map((entry) => (
            <Group key={`${entry.dayOfWeek}-${entry.start}`} gap="xs">
              <Text size="sm" fw={500}>
                {DAY_LABELS[entry.dayOfWeek]} {formatMinute(entry.start)}–{formatMinute(entry.end)}
              </Text>
              <Badge variant="light">{entry.count} available</Badge>
              {entry.missing.length > 0 && (
                <Text size="xs" c="dimmed">
                  missing: {missingNames(entry, names).join(', ')}
                </Text>
              )}
            </Group>
          ))
        )}
      </Stack>
    </Stack>
  )
}
