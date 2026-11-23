import { Badge, Tooltip } from '@mantine/core'
import { useChampions } from '../../api/hooks.ts'
import { patchStatusView } from '../../lib/champions/patch-status.ts'

/**
 * The header's statement about the champion cache (hexserve-champion-data.md §5): which patch the
 * labels come from, when it was published, and whether it is still the newest one.
 *
 * It reads the same `useChampions()` query the champion components do, so the chip costs no extra
 * request and cannot disagree with the names rendered in the page below it.
 *
 * Degrades to nothing: while loading, or when the endpoint failed, the header simply has no chip.
 * A reference-data badge is not worth an error state.
 */
export function PatchStatus() {
  const { data } = useChampions()
  if (!data) return null

  const view = patchStatusView(data)

  if (view.kind === 'empty') {
    return (
      <Tooltip label="Champion data could not be fetched yet">
        <Badge color="gray" variant="light">
          No champion data
        </Badge>
      </Tooltip>
    )
  }

  return (
    <Tooltip label={view.tooltip} multiline w={240}>
      <Badge color={view.tone === 'current' ? 'brand' : 'orange'} variant="light">
        {view.text}
      </Badge>
    </Tooltip>
  )
}
