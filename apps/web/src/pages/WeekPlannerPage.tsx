import type { PlannerTemplateDto, PlannerWeekDto } from '@lol/api/schema-types'
import {
  Badge,
  Button,
  Group,
  Loader,
  NativeSelect,
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
import { GridEditor } from '../components/GridEditor.tsx'
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
  const [view, setView] = useState<'paint' | 'playable' | 'regular'>('paint')
  /** Set while reading the archive: a past week replaces the live one, it does not stack under it. */
  const [pastWeek, setPastWeek] = useState<string | null>(null)

  const data = planner.data
  const weeks = data?.weeks ?? []
  const week = weeks[Number(selected)] ?? weeks[0]

  const names: Record<string, string> = {}
  for (const entry of roster.data ?? []) names[entry.userId] = entry.displayName

  if (planner.isPending || !data || !week || !template.data) return <Loader size="sm" />

  // the team's idea of "today", from the API — never the browser's, so the mark is the same for
  // everybody in the team even if they are in another timezone
  const currentWeek = currentWeekStart(data.today)
  const pastWeeks = weekStartsBefore(data.windowStart, 4).map((startsOn) => ({
    value: startsOn,
    label: weekHeading(startsOn, data.windowStart),
  }))

  return (
    <Stack gap="lg" maw={980} mx="auto" w="100%">
      <Group justify="space-between" align="flex-end">
        <Title order={2}>Week planner</Title>
        <Text size="sm" c="dimmed">
          {data.timezone}
        </Text>
      </Group>

      {/*
        The captain's panel, in the same place for both cases: it moves the live window, or it
        reopens the past week on screen. It is never shown to a member, and never shown to a captain
        when it would control something that is not visible.
      */}
      {me.data?.role === 'captain' &&
        (pastWeek ? (
          <PastWeekControls slug={slug} startsOn={pastWeek} />
        ) : (
          <WindowControls slug={slug} windowStart={data.windowStart} today={data.today} />
        ))}

      {/*
        What the week is shown as, before which week it is: the switch reads above the tabs, since
        it governs the whole area below. Regular times comes first because it is the one that is not
        about a week, but the page still opens on my availability — the thing you came here to paint.
      */}
      {!pastWeek && (
        <SegmentedControl
          size="xs"
          w="fit-content"
          value={view}
          onChange={(value) => setView(value as 'paint' | 'playable' | 'regular')}
          data={[
            { label: 'My regular times', value: 'regular' },
            { label: 'My availability', value: 'paint' },
            { label: 'Playable times', value: 'playable' },
          ]}
        />
      )}

      <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
        {pastWeek ? (
          <Group gap="xs" align="center">
            <Badge variant="light" color="gray">
              past week
            </Badge>
            <Text fw={500}>{weekHeading(pastWeek, data.windowStart)}</Text>
            {/* the way out of history is the point of being in it: filled, not a third ghost */}
            <Button
              size="xs"
              variant="filled"
              leftSection={<IconArrowBackUp size={14} />}
              onClick={() => setPastWeek(null)}
            >
              Back to the live week
            </Button>
          </Group>
        ) : (
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
        )}

        {/*
          The archive: weeks that have slid out of the two-week window. Derived from the window
          (§5), loaded only when picked, and read-only unless a captain opens one for writing.
        */}
        <NativeSelect
          size="xs"
          w={210}
          label="Past week"
          data={[{ value: '', label: 'Look at a past week' }, ...pastWeeks]}
          value={pastWeek ?? ''}
          onChange={(event) => setPastWeek(event.currentTarget.value || null)}
        />
      </Group>

      {/*
        A captain may have skipped ahead, so the tab marked "now" can be off-screen. Saying so is
        better than a window that looks current while the calendar has moved on.
      */}
      {!pastWeek && !data.weeks.some((entry) => entry.startsOn === currentWeek) && (
        <Text size="sm" c="dimmed">
          This window starts later than the current week ({weekRange(currentWeek)} · Week{' '}
          {isoWeekNumber(currentWeek)}).
        </Text>
      )}

      {/*
        Remounted per week and per answer set, so the grid is always the server's version of what
        I said — never a merge of it with what I happened to have painted before a save landed.
      */}
      {pastWeek ? (
        <PastWeekView
          slug={slug}
          startsOn={pastWeek}
          windowStart={data.windowStart}
          meId={me.data?.id ?? ''}
          names={names}
        />
      ) : (
        <>
          {view === 'paint' && (
            <PlannerBoard
              key={`${week.startsOn}:${week.answered.join(',')}`}
              slug={slug}
              week={week}
              template={template.data}
              meId={me.data?.id ?? ''}
            />
          )}
          {view === 'playable' && <PlayableView week={week} names={names} />}
          {/*
            My standing times are about me, not about this Tuesday: a third view rather than a
            section under the grid, because "when am I generally free" is the same kind of question
            as the other two and deserves the same place on the page.
          */}
          {view === 'regular' && <RegularSlots slug={slug} />}
        </>
      )}
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

/**
 * The captain's says over a past week (§5): reading is open to everyone, writing is not.
 *
 * It sits where the live window controls sit, because it is the same decision in a different tense —
 * "which weeks am I allowed to touch" — and because the alternative was a lone button floating above
 * the week it acts on, with nothing saying who may press it.
 */
function PastWeekControls({ slug, startsOn }: { slug: string; startsOn: string }) {
  const week = useWeek(slug, startsOn)
  const unlock = useUnlockWeek(slug)

  const open = week.data?.unlocked ?? false

  return (
    <Paper withBorder radius="sm" p="xs" role="group" aria-label="Captain controls for a past week">
      <Stack gap={4}>
        <Group gap="sm" align="center" wrap="wrap">
          <Badge variant="light" color="orange">
            Captain only
          </Badge>
          <Text size="sm" fw={500}>
            {open ? 'This past week is open for editing' : 'This past week is closed'}
          </Text>

          <Group gap="xs" ml="auto">
            <Button
              size="xs"
              variant="default"
              loading={unlock.isPending}
              onClick={() =>
                unlock.mutate(
                  { startsOn, unlocked: !open },
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
        </Group>

        <Text size="xs" c="dimmed">
          Only a captain can reopen a finished week. Reopening lets every member save changes to it
          again; closing it turns the grid back into something everybody can only read.
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
    <GridEditor
      label="Your availability"
      startsOn={week.startsOn}
      description={
        answered
          ? 'Your week as saved — repaint and save again to change it.'
          : 'Starting from your regular times. Nothing is saved until you save.'
      }
      grid={paint.grid}
      onBegin={paint.begin}
      onDrag={paint.drag}
      onEnd={paint.end}
      onUndo={paint.undo}
      canUndo={paint.canUndo}
      dirty={paint.dirty}
      saving={save.isPending}
      saveLabel="Save my week"
      onSave={onSave}
    />
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
  // keyed by id: two members may share a display name, and chips are React children
  const stillToAnswer = week.unanswered.map((userId) => ({ userId, name: names[userId] ?? '?' }))

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

      {/*
        A sentence ("Still to answer: Ben, Cem") is a line you walk past, and these names are the
        reason the grid understates the week: somebody who has not answered has no rows at all, so
        the shades count only the people who did. One chip per person says that at a glance.
      */}
      <Group gap={6} align="center" role="group" aria-label="Waiting on">
        <Text size="sm" c="dimmed">
          Waiting on:
        </Text>
        {stillToAnswer.length === 0 ? (
          <Text size="sm" c="dimmed">
            everyone has answered
          </Text>
        ) : (
          stillToAnswer.map((entry) => (
            <Badge key={entry.userId} size="sm" variant="light" color="gray">
              {entry.name}
            </Badge>
          ))
        )}
      </Group>

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
 * One past week (§5): every member may look, the captain may open a finished week for writing.
 *
 * Reading and writing are drawn separately on purpose — visibility is derived from today, so a past
 * week needs no unlocking to be *seen*; `unlockedAt` only decides whether the grid accepts paint.
 * Which week it is, is chosen once, at the top of the page, so the answer appears where the question
 * was asked instead of in a section four scrolls down.
 */
function PastWeekView({
  slug,
  startsOn,
  windowStart,
  meId,
  names,
}: {
  slug: string
  startsOn: string
  windowStart: string
  meId: string
  names: Record<string, string>
}) {
  const week = useWeek(slug, startsOn)
  const template = usePlannerTemplate(slug)

  const current = week.data
  const open = current?.unlocked ?? false

  if (week.isPending || !current) return <Loader size="xs" />

  return (
    <Stack gap="sm">
      {open && template.data ? (
        <PlannerBoard
          key={`history:${current.startsOn}:${current.answered.join(',')}:${windowStart}`}
          slug={slug}
          week={current}
          template={template.data}
          meId={meId}
        />
      ) : (
        <PlayableView week={current} names={names} />
      )}
    </Stack>
  )
}
