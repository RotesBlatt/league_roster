import { Box, Paper, Stack, Text, UnstyledButton } from '@mantine/core'
import { IconArrowDown, IconArrowUp, IconEye, IconTransfer, IconTrash } from '@tabler/icons-react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ChipAction, ChipActionKey } from '../../lib/pools/chip-actions.ts'
import styles from './ChipActions.module.css'

/**
 * The chip's action panel, **at the pointer** (champion-pools.md §7).
 *
 * A `Menu` anchored to the chip was wrong twice: it rendered at the page's top-left because the
 * anchor was a component that could not forward its ref (so Floating UI had no rect to measure), and
 * it stayed open until something else closed it. This panel is positioned from the `contextmenu`
 * event's own coordinates and closes on the three things a person actually does next: leaves it,
 * presses Escape, or clicks anywhere else.
 *
 * Rendered into a portal because the chip lives inside a transformed, scrollable grid — a panel
 * nested there would be clipped by the column and moved by the drag transform.
 */

const ICONS = {
  up: <IconArrowUp size={14} />,
  down: <IconArrowDown size={14} />,
  'to-other-section': <IconTransfer size={14} />,
  'to-blind': <IconEye size={14} />,
  remove: <IconTrash size={14} />,
} satisfies Record<ChipActionKey, React.ReactNode>

const WIDTH = 190
const HEIGHT = 190

/** Keep the panel on screen: a right-click near the edge must not open a clipped menu. */
function clamp(at: { x: number; y: number }): { x: number; y: number } {
  const maxX = Math.max(8, window.innerWidth - WIDTH - 8)
  const maxY = Math.max(8, window.innerHeight - HEIGHT - 8)
  return { x: Math.min(at.x, maxX), y: Math.min(at.y, maxY) }
}

export function ChipActions({
  at,
  actions,
  onClose,
  onApply,
}: {
  /** `null` = closed. Screen coordinates of the right-click. */
  at: { x: number; y: number } | null
  actions: ChipAction[]
  onClose: () => void
  /** Called with the lists the chosen action produces. */
  onApply: (action: ChipAction) => void
}) {
  const panel = useRef<HTMLDivElement | null>(null)
  // the effect must not re-subscribe on every render just because the parent passed a new closure
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    if (!at) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current()
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && panel.current?.contains(target)) return
      close.current()
    }
    const onScroll = () => close.current()

    document.addEventListener('keydown', onKeyDown)
    // capture, so a click that a chip would swallow still closes the panel
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [at])

  if (!at) return null

  const { x, y } = clamp(at)

  return createPortal(
    <Box
      ref={panel}
      className={styles.panel}
      pos="fixed"
      // explicit px: Mantine turns a numeric style prop into rem, and a menu at "7.5rem" is a
      // cursor position nobody can reason about (or assert on)
      top={`${y}px`}
      left={`${x}px`}
      w={WIDTH}
      onMouseLeave={onClose}
      role="menu"
    >
      <Paper withBorder shadow="md" radius="sm" p={4}>
        <Stack gap={0}>
          {actions.map((action) => (
            <UnstyledButton
              key={action.key}
              role="menuitem"
              className={styles.action}
              data-danger={action.danger ? 'true' : undefined}
              disabled={action.disabled}
              onClick={() => {
                onApply(action)
                onClose()
              }}
            >
              <Box component="span" className={styles.icon}>
                {ICONS[action.key]}
              </Box>
              <Text size="sm">{action.label}</Text>
            </UnstyledButton>
          ))}
        </Stack>
      </Paper>
    </Box>,
    document.body,
  )
}
