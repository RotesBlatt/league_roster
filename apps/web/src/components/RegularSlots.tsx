import type { PlannerTemplateDto } from '@lol/api/schema-types'
import { Button, Group, Loader, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconArrowBackUp } from '@tabler/icons-react'
import { daysFromGrid, gridFromDays } from '../availability-grid.ts'
import { usePlannerTemplate, useSaveTemplate } from '../hooks.ts'
import { usePaintGrid } from '../use-paint-grid.ts'
import { AvailabilityGrid } from './AvailabilityGrid.tsx'

/**
 * My standing times (`availability_template`, availability-planner.md §4b).
 *
 * A template is a *suggestion* for the next week, not an answer about any week: saving here can
 * only influence weeks nobody has answered yet, and it never rewrites one that was. That is why
 * this editor lives outside the week tabs — it is about me, not about this Tuesday.
 */
export function RegularSlots({ slug }: { slug: string }) {
  const template = usePlannerTemplate(slug)
  if (!template.data) return <Loader size="xs" />

  // remounted when the stored schedule changes, so the grid is the server's version, not a merge
  return (
    <SlotsEditor key={JSON.stringify(template.data.days)} slug={slug} template={template.data} />
  )
}

function SlotsEditor({ slug, template }: { slug: string; template: PlannerTemplateDto }) {
  const save = useSaveTemplate(slug)
  const paint = usePaintGrid(gridFromDays(template.days))

  const onSave = () =>
    save.mutate(daysFromGrid(paint.grid), {
      onSuccess: () => notifications.show({ message: 'Regular times saved', color: 'green' }),
      onError: (error: Error) => notifications.show({ message: error.message, color: 'red' }),
    })

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        A week you have not answered yet starts from these times. Saving here never changes a week
        you already answered.
      </Text>

      <AvailabilityGrid
        grid={paint.grid}
        label="Regular times grid"
        onBegin={paint.begin}
        onDrag={paint.drag}
        onEnd={paint.end}
      />

      <Group justify="flex-end" gap="xs">
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
          Save my regular times
        </Button>
      </Group>
    </Stack>
  )
}
