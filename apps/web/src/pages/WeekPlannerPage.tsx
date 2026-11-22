import type { PlannerTemplateDto, PlannerWeekDto } from '@lol/api/schema-types'
import { Accordion, Badge, Button, Group, Loader, Stack, Tabs, Text, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconArrowBackUp, IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import { useState } from 'react'
import { useParams } from 'react-router'
import { daysFromGrid, formatMinute, gridFromDays } from '../availability-grid.ts'
import { AvailabilityGrid } from '../components/AvailabilityGrid.tsx'
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
  flattenWindows,
  initialDays,
  isProvisional,
  missingNames,
  provisionalText,
  weekHeading,
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

  const data = planner.data
  const weeks = data?.weeks ?? []
  const week = weeks[Number(selected)] ?? weeks[0]

  const names: Record<string, string> = {}
  for (const entry of roster.data ?? []) names[entry.userId] = entry.displayName

  if (planner.isPending || !data || !week || !template.data) return <Loader size="sm" />

  return (
    <Stack gap="lg" maw={980} mx="auto" w="100%">
      <Group justify="space-between" align="flex-end">
        <Title order={2}>Week planner</Title>
        <Text size="sm" c="dimmed">
          {data.timezone}
        </Text>
      </Group>

      {me.data?.role === 'captain' && <WindowControls slug={slug} />}

      <Tabs value={selected} onChange={(value) => setSelected(value ?? '0')}>
        <Tabs.List>
          {data.weeks.map((entry, index) => (
            <Tabs.Tab key={entry.startsOn} value={String(index)}>
              {weekHeading(entry.startsOn, data.windowStart)}
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
function WindowControls({ slug }: { slug: string }) {
  const skip = useSkipWindow(slug)
  const reset = useResetWindow(slug)

  const refuse = (error: Error) => notifications.show({ message: error.message, color: 'orange' })

  return (
    <Group gap="xs">
      <Text size="sm" c="dimmed">
        Window
      </Text>
      <Button
        size="xs"
        variant="default"
        leftSection={<IconChevronLeft size={14} />}
        onClick={() => skip.mutate(-1, { onError: refuse })}
        loading={skip.isPending}
      >
        Back
      </Button>
      <Button
        size="xs"
        variant="default"
        rightSection={<IconChevronRight size={14} />}
        onClick={() => skip.mutate(1, { onError: refuse })}
        loading={skip.isPending}
      >
        Forward
      </Button>
      <Button
        size="xs"
        variant="subtle"
        onClick={() => reset.mutate(undefined, { onError: refuse })}
        loading={reset.isPending}
      >
        Back to this week
      </Button>
    </Group>
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

      <WeekSummary week={week} names={names} />
    </Stack>
  )
}

/**
 * The merged summary: how provisional the week is, who has not answered, and the sessions the
 * answers make possible (§6, §9). Shared by the live board and by a read-only past week, because
 * "what was playable then" is the same question as "what is playable now".
 */
function WeekSummary({ week, names }: { week: PlannerWeekDto; names: Record<string, string> }) {
  const ranked = flattenWindows(week)
  const stillToAnswer = week.unanswered.map((userId) => names[userId] ?? '?')

  return (
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
              names={names}
            />
          ) : (
            <WeekSummary week={current} names={names} />
          )}
        </Stack>
      )}
    </Stack>
  )
}
