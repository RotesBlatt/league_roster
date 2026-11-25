import type { PoolPersonDto } from '@lol/api/schema-types'
import { canEditPool, type PoolKind, type PoolLists } from '@lol/shared'
import { notifications } from '@mantine/notifications'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { POOLS_KEY, useSavePool } from '../../api/hooks.ts'
import { addChampion } from './pool-edit.ts'
import { saveFailure } from './pool-save.ts'
import { createSaveQueue, type SaveQueue } from './save-queue.ts'

/**
 * The editable state of **one** pool column (champion-pools.md §5, §7) — and its autosave.
 *
 * There is no Save button: every gesture is a complete statement about the pool, so it is written
 * immediately. The ordering guarantees (one request at a time, coalesced follow-ups, the version the
 * previous write returned) live in `save-queue.ts`, which is unit-tested; this hook only wires that
 * queue to React Query and decides *when the local draft is replaced by the server's pool*.
 */
export type PoolEditor = {
  /** Owner and loaded: the column may grow handles. */
  editing: boolean
  /** What the column renders: the draft, else what the server said, else `null` while loading. */
  shown: PoolLists | null
  /** A write is in flight — the page says "saving…" instead of pretending it is instant. */
  saving: boolean
  onChange: (lists: PoolLists) => void
  onPick: (kind: PoolKind, championId: number) => void
}

export function usePoolEditor(
  mine: PoolPersonDto | null,
  viewer: { id: string; role: 'captain' | 'member' } | null,
): PoolEditor {
  const save = useSavePool()
  const queryClient = useQueryClient()

  const [draft, setDraft] = useState<PoolLists | null>(null)
  const [saving, setSaving] = useState(false)

  /**
   * The queue outlives renders, so its callbacks read the newest render's services through this ref
   * rather than capturing the first one. `setSaving` is stable and can be handed over directly.
   */
  const services = useRef<{ save: typeof save; queryClient: QueryClient }>({ save, queryClient })
  services.current = { save, queryClient }

  const queue = useRef<SaveQueue | null>(null)
  if (queue.current === null) {
    queue.current = createSaveQueue({
      version: 0,
      send: (input) => services.current.save.mutateAsync(input),
      onSavingChange: setSaving,
      onFailure: (error) => {
        const failure = saveFailure(error)
        notifications.show({ message: failure.message, color: failure.color })
        // "showing the latest version" has to be true: the cache still holds the version we read
        if (failure.reload) {
          void services.current.queryClient.invalidateQueries({ queryKey: POOLS_KEY })
        }
        // a refusal means the local draft is a lie either way — somebody else wrote first, or a
        // rule the page should have caught. Drop it and let the read show what is stored.
        setDraft(null)
      },
    })
  }

  const editing = mine !== null && canEditPool(viewer, mine.userId)
  const shown = draft ?? mine?.lists ?? null
  const serverVersion = mine?.version ?? null

  // the server's version is the floor for the next write (the queue ignores it mid-flight)
  useEffect(() => {
    if (serverVersion !== null) queue.current?.setVersion(serverVersion)
  }, [serverVersion])

  // a read while nothing is being written is the truth: adopt it. While a write is in flight the
  // draft is newer than the cache and must not be replaced by what that write is about to change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the version is the trigger, not a read
  useEffect(() => {
    if (queue.current?.idle()) setDraft(null)
  }, [serverVersion])

  const onChange = (lists: PoolLists) => {
    // optimistic: the chips move now, the write follows. A failure drops the draft above.
    setDraft(lists)
    queue.current?.push(lists)
  }

  /** The `+` in a band opens its own popover; this only records the pick in the draft. */
  const onPick = (kind: PoolKind, championId: number) => {
    if (!shown) return
    onChange(addChampion(shown, kind, championId))
  }

  return { editing, shown, saving, onChange, onPick }
}
