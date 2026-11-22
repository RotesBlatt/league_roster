import type { PlannerTemplateDto } from '@lol/api/schema-types'
import { Loader } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { usePlannerTemplate, useSaveTemplate } from '../../api/hooks.ts'
import { daysFromGrid, gridFromDays } from '../../lib/planner/availability-grid.ts'
import { usePaintGrid } from '../../lib/planner/use-paint-grid.ts'
import { GridEditor } from './GridEditor.tsx'

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

  /*
    Deliberately not re-keyed on `template.data`: saving invalidates the query, and a remount
    there would discard the one-step undo straight after the autosave that wrote the schedule.
    Switching away and back still opens on the stored version, which is the case that matters.
  */
  return <SlotsEditor slug={slug} template={template.data} />
}

function SlotsEditor({ slug, template }: { slug: string; template: PlannerTemplateDto }) {
  const save = useSaveTemplate(slug)
  const paint = usePaintGrid(gridFromDays(template.days))

  const onSave = () => {
    // the revision the save is about: anything painted while it was in flight stays dirty
    const revision = paint.revision
    save.mutate(daysFromGrid(paint.grid), {
      onSuccess: () => {
        paint.markSaved(revision)
        notifications.show({ message: 'Regular times saved', color: 'green' })
      },
      onError: (error: Error) => notifications.show({ message: error.message, color: 'red' }),
    })
  }

  return (
    <GridEditor
      label="Regular times grid"
      description="A week you have not answered yet starts from these times. Saving here never changes a week you already answered."
      grid={paint.grid}
      onBegin={paint.begin}
      onDrag={paint.drag}
      onEnd={paint.end}
      onUndo={paint.undo}
      canUndo={paint.canUndo}
      dirty={paint.dirty}
      revision={paint.revision}
      saving={save.isPending}
      saveLabel="Save my regular times"
      onSave={onSave}
    />
  )
}
