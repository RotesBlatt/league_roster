import type { PlannerWeekDto } from '@lol/api/schema-types'
import { MIN_PLAYABLE } from '@lol/shared'
import { Group, Stack, Text } from '@mantine/core'
import { formatMinute, SLOT_MINUTES } from '../lib/planner/availability-grid.ts'
import { coverageFromWeek, playableFromWeek } from '../lib/planner/playable-grid.ts'
import { cellName, ROW_HEIGHT, rowRule, WeekGridFrame } from './WeekGridFrame.tsx'

/** Three shades, because four would be a palette nobody learns. `MIN_PLAYABLE` sets the top one. */
type Band = 'none' | 'few' | 'many'

const bandOf = (count: number): Band =>
  count === 0 ? 'none' : count >= MIN_PLAYABLE ? 'many' : 'few'

const BAND_BACKGROUND: Record<Band, string> = {
  none: 'rgba(0,0,0,0.045)',
  few: 'var(--mantine-color-brand-2)',
  many: 'var(--mantine-color-brand-6)',
}

/**
 * The team's week, read-only: how many people are free in each half hour, and where a playable
 * window sits.
 *
 * It is the twin of `AvailabilityGrid` on purpose — same axis, same rows, same day heads, all from
 * `WeekGridFrame` — and it is deliberately *not* that component with a flag: nothing here takes a
 * pointer event, so the page cannot accidentally let a member paint somebody else's answer (§3:
 * availability is mine).
 *
 * The numbers are `playable-grid.ts`'s; the windows are the API's (`findPlayWindows`). A cell only
 * counts a person when they are free for the whole half hour, which is why the outline, not the
 * shade, is what marks a window: dark means "many free", outlined means "this is a session".
 */
export function PlayableGrid({ week, label }: { week: PlannerWeekDto; label: string }) {
  const coverage = coverageFromWeek(week)
  const playable = playableFromWeek(week)

  return (
    <Stack gap="xs">
      <WeekGridFrame
        label={label}
        startsOn={week.startsOn}
        renderCell={({ dayOfWeek, index, minute }) => {
          const count = coverage[dayOfWeek]?.[index] ?? 0
          const band = bandOf(count)
          const isWindow = playable[dayOfWeek]?.[index] === true
          const name = cellName(dayOfWeek, minute)

          return (
            <div
              // a plain div, not a button: a cell you cannot press must not look pressable.
              // A div cannot carry `aria-label` (no role to attach it to), and 336 of them read out
              // one by one would be worse than useless — so the numbers live in the tooltip, the
              // group carries the name, and "who is missing" stays in the text list above this grid.
              key={name}
              aria-hidden="true"
              data-count={count}
              data-band={band}
              data-playable={isWindow ? 'true' : 'false'}
              title={`${name}–${formatMinute(minute + SLOT_MINUTES)} · ${count === 0 ? 'nobody free' : `${count} free`}${
                isWindow ? ' · playable' : ''
              }`}
              style={{
                height: ROW_HEIGHT,
                border: 'none',
                borderTop: rowRule(index),
                outline: isWindow ? '2px solid var(--mantine-color-brand-9)' : 'none',
                outlineOffset: '-1px',
                background: BAND_BACKGROUND[band],
              }}
            />
          )
        }}
      />

      <Group gap="lg">
        <Legend color={BAND_BACKGROUND.none} text="nobody" />
        <Legend color={BAND_BACKGROUND.few} text="1–3" />
        <Legend color={BAND_BACKGROUND.many} text="4+" />
        <Group gap={6} align="center">
          <div
            style={{
              width: 14,
              height: 10,
              outline: '2px solid var(--mantine-color-brand-9)',
              outlineOffset: '-1px',
            }}
          />
          <Text size="xs" c="dimmed">
            playable window
          </Text>
        </Group>
      </Group>
    </Stack>
  )
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <Group gap={6} align="center">
      <div style={{ width: 14, height: 10, background: color }} />
      <Text size="xs" c="dimmed">
        {text}
      </Text>
    </Group>
  )
}
