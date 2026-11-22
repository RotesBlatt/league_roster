import type { PlannerTemplateDto, PlannerWeekDto } from '@lol/api/schema-types'
import {
  Accordion,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  SegmentedControl,
  Stack,
  Tabs,
  Text,
  Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconArrowBackUp, IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import { useState } from 'react'
import { useParams } from 'react-router'
import { daysFromGrid, formatMinute, gridFromDays } from '../availability-grid.ts'
import { AvailabilityGrid } from '../components/AvailabilityGrid.tsx'
import { PlayableGrid } from '../components/PlayableGrid.tsx'
import { RegularSlots } from '../components/RegularSlots.tsx'
import {
  useMe,
  usePlanner,
  usePlannerTemplate,
  useResetWindow,
  useRoster,
  useSaveWeek,
  useSkipWindow,
  useUnlockWeek,
  useWeek,
} from '../hooks.ts'
import {
  currentWeekStart,
  flattenWindows,
  initialDays,
  isoWeekNumber,
  isProvisional,
  missingNames,
  provisionalText,
  weekHeading,
  weekRange,
  weekStartsBefore,
} from '../planner.ts'
import { usePaintGrid } from '../use-paint-grid.ts'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

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
  /** Paint, or read: the same week from my side and from the team's. Paint is the default. */
  const [view, setView] = useState<'paint' | 'playable'>('paint')

  const data = planner.data
  const weeks = data?.weeks ?? []
  const week = weeks[Number(selected)] ?? weeks[0]

  const names: Record<string, string> = {}
  for (const entry of roster.data ?? []) names[entry.userId] = entry.displayName

  if (planner.isPending || !data || !week || !template.data) return <Loader size="sm" />

  // the team's idea of "today", from the API — never the browser's, so the mark is the same for
  // everybody in the team even if they are in another timezone
  const currentWeek = currentWeekStart(data.today)

  return (
    <Stack gap="lg" maw={980} mx="auto" w="100%">
      <Group justify="space-between" align="flex-end">
        <Title order={2}>Week planner</Title>
        <Text size="sm" c="dimmed">
          {data.timezone}
        </Text>
      </Group>

      {me.data?.role === 'captain' && (
        <WindowControls slug={slug} windowStart={data.windowStart} today={data.today} />
      )}

      <Tabs value={selected} onChange={(value) => setSelected(value ?? '0')}>
        <Tabs.List>
          {data.weeks.map((entry, index) => (
            <Tabs.Tab key={entry.startsOn} value={String(index)}>
              <Group gap={6} wrap="nowrap">
                {weekHeading(entry.startsOn, data.windowStart)}
                {entry.startsOn === currentWeek && (
                  <Badge size="xs" color="green" variant="filled" radius="sm">
                    now
                  </Badge>
                )}
              </Group>
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>

      {/*
        A captain may have skipped ahead, so the tab marked "now" can be off-screen. Saying so is
        better than a window that looks current while the calendar has moved on.
      */}
      {!data.weeks.some((entry) => entry.startsOn === currentWeek) && (
        <Text size="sm" c="dimmed">
          This window starts later than the current week ({weekRange(currentWeek)} · Week{' '}
          {isoWeekNumber(currentWeek)}).
        </Text>
      )}

      {/*
        Remounted per week and per answer set, so the grid is always the server's version of what
        I said — never a merge of it with what I happened to have painted before a save landed.
      */}
      {/*
        Two views of one week, not two things: what I can paint, and what the team can play. A
        segmented control rather than a second tab row, because the week tab above already changed
        *which* week — this only changes how the same week is read.
      */}
      <SegmentedControl
        size="xs"
        w="fit-content"
        value={view}
        onChange={(value) => setView(value === 'playable' ? 'playable' : 'paint')}
        data={[
          { label: 'My availability', value: 'paint' },
          { label: 'Playable times', value: 'playable' },
        ]}
      />

      {view === 'paint' ? (
        <PlannerBoard
          key={`${week.startsOn}:${week.answered.join(',')}`}
          slug={slug}
          week={week}
          template={template.data}
          meId={me.data?.id ?? ''}
        />
      ) : (
        <PlayableView week={week} names={names} />
      )}

      <Accordion variant="separated">
        <Accordion.Item value="regular">
          <Accordion.Control>My regular times</Accordion.Control>
          <Accordion.Panel>
            <RegularSlots slug={slug} />
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>

      <HistoryPanel
        slug={slug}
        windowStart={data.windowStart}
        meId={me.data?.id ?? ''}
        names={names}
        isCaptain={me.data?.role === 'captain'}
      />
    </Stack>
  )
}

/**
 * The captain's window moves (availability-planner.md §5).
 *
 * Skip is team state: it moves the window for everyone, and the server — not this component —
 * decides whether a click was allowed. A refusal (the cap, or "already on this week") is shown as
 * the sentence the API sent, because "nothing happened" is not an answer a captain can act on.
 */
function WindowControls({
  slug,
  windowStart,
  today,
}: {
  slug: string
  windowStart: string
  today: string
}) {
  const skip = useSkipWindow(slug)
  const reset = useResetWindow(slug)

  const refuse = (error: Error) => notifications.show({ message: error.message, color: 'orange' })
  const atThisWeek = currentWeekStart(today) === windowStart

  return (
    <Paper withBorder radius="sm" p="xs">
      <Stack gap={4}>
        <Group gap="sm" align="center" wrap="wrap">
          <Badge variant="light" color="orange">
            Captain only
          </Badge>
          <Text size="sm" fw={500}>
            Planning {weekRange(windowStart)} · Week {isoWeekNumber(windowStart)}
          </Text>

          <Group gap="xs" ml="auto">
            <Button
              size="xs"
              variant="default"
              leftSection={<IconChevronLeft size={14} />}
              onClick={() => skip.mutate(-1, { onError: refuse })}
              loading={skip.isPending}
            >
              Earlier week
            </Button>
            <Button
              size="xs"
              variant="default"
              rightSection={<IconChevronRight size={14} />}
              onClick={() => skip.mutate(1, { onError: refuse })}
              loading={skip.isPending}
            >
              Later week
            </Button>
            {/* outlined like its siblings: as a subtle button it looked like a caption, not a
                control, and "can I press this?" was a fair question */}
            <Button
              size="xs"
              variant="default"
              onClick={() => reset.mutate(undefined, { onError: refuse })}
              loading={reset.isPending}
              disabled={atThisWeek}
            >
              Back to this week
            </Button>
          </Group>
        </Group>

        <Text size="xs" c="dimmed">
          Moves the two-week view for the whole team. Nothing is deleted — a week that leaves the
          window stays in History.
        </Text>
      </Stack>
    </Paper>
  )
}

function PlannerBoard({
  slug,
  week,
  template,
  meId,
}: {
  slug: string
  week: PlannerWeekDto
  template: PlannerTemplateDto
  meId: string
}) {
  const save = useSaveWeek(slug)
  const paint = usePaintGrid(gridFromDays(initialDays(week, template, meId)))

  const answered = week.answered.includes(meId)

  const onSave = () => {
    save.mutate(
      { startsOn: week.startsOn, days: daysFromGrid(paint.grid) },
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
            onClick={paint.undo}
            disabled={!paint.canUndo}
          >
            Undo
          </Button>
          <Button size="sm" onClick={onSave} loading={save.isPending} disabled={!paint.dirty}>
            Save my week
          </Button>
        </Group>
      </Group>

      <AvailabilityGrid
        grid={paint.grid}
        label="Your availability"
        startsOn={week.startsOn}
        onBegin={paint.begin}
        onDrag={paint.drag}
        onEnd={paint.end}
      />
    </Stack>
  )
}

/**
 * The team's side of a week: the grid of who is free when, how provisional that is, and the sessions
 * the answers make possible (§6, §9).
 *
 * Shared by the live week's second view and by a read-only past week, because "what was playable
 * then" is the same question as "what is playable now". The ranked list stays: the grid says *when*,
 * the list says *who cannot make it*, and a session is a decision about people.
 */
function PlayableView({ week, names }: { week: PlannerWeekDto; names: Record<string, string> }) {
  const ranked = flattenWindows(week)
  const stillToAnswer = week.unanswered.map((userId) => names[userId] ?? '?')

  return (
    <Stack gap="sm">
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

      <PlayableGrid week={week} label="Everyone’s availability" />

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
  )
}

/**
 * The past (§5): every member may look, the captain may open a finished week for writing.
 *
 * Reading and writing are drawn separately on purpose — visibility is derived from today, so a
 * past week needs no unlocking to be *seen*; `unlockedAt` only decides whether the grid below it
 * accepts paint.
 */
function HistoryPanel({
  slug,
  windowStart,
  meId,
  names,
  isCaptain,
}: {
  slug: string
  windowStart: string
  meId: string
  names: Record<string, string>
  isCaptain: boolean
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const history = weekStartsBefore(windowStart, 4)
  const week = useWeek(slug, selected)
  const template = usePlannerTemplate(slug)
  const unlock = useUnlockWeek(slug)

  const current = week.data
  const open = current?.unlocked ?? false

  return (
    <Stack gap="sm">
      <Title order={4}>History</Title>

      <Group gap="xs">
        {history.map((startsOn) => (
          <Button
            key={startsOn}
            size="xs"
            variant={selected === startsOn ? 'light' : 'default'}
            onClick={() => setSelected(startsOn)}
          >
            {weekHeading(startsOn, windowStart)}
          </Button>
        ))}
      </Group>

      {selected && week.isPending && <Loader size="xs" />}

      {current && (
        <Stack gap="sm">
          {isCaptain && (
            <Group gap="xs">
              <Button
                size="xs"
                variant="default"
                loading={unlock.isPending}
                onClick={() =>
                  unlock.mutate(
                    { startsOn: current.startsOn, unlocked: !open },
                    {
                      onError: (error: Error) =>
                        notifications.show({ message: error.message, color: 'orange' }),
                    },
                  )
                }
              >
                {open ? 'Close week' : 'Open for editing'}
              </Button>
              {open && (
                <Badge color="blue" variant="light">
                  open for edits
                </Badge>
              )}
            </Group>
          )}

          {open && template.data ? (
            <PlannerBoard
              key={`history:${current.startsOn}:${current.answered.join(',')}`}
              slug={slug}
              week={current}
              template={template.data}
              meId={meId}
            />
          ) : (
            <PlayableView week={current} names={names} />
          )}
        </Stack>
      )}
    </Stack>
  )
}
