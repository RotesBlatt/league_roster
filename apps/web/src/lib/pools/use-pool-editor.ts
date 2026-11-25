import type { PoolPersonDto } from '@lol/api/schema-types'
import { canEditPool, type PoolKind, type PoolLists } from '@lol/shared'
import { notifications } from '@mantine/notifications'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { POOLS_KEY, useSavePool } from '../../api/hooks.ts'
import { addChampion } from './pool-edit.ts'
import { isDirty, saveFailure } from './pool-save.ts'

/**
 * The draft/save state of **one** editable pool column (champion-pools.md §5, §7).
 *
 * It lives here rather than in `PoolsPage` because it is four decisions, and a page that owns them
 * also owns every branch of them:
 *
 * - **who may edit** — the shared `canEditPool`, the same rule the API enforces;
 * - **what a draft is** — local edits until one `Save pool` sends the whole pool with the version
 *   this page read;
 * - **when a draft dies** — a new server version (ours or somebody else's) makes it stale;
 * - **what a refusal means** — `409` drops the draft *and* refetches so "showing the latest version"
 *   is true; other failures keep it so the user can retry.
 *
 * Behaviour lives in the pure `pool-edit` / `pool-save` modules; this is the wiring that holds them.
 */
export type PoolEditor = {
  /** Owner and loaded: the column may grow handles. */
  editing: boolean
  /** What the column renders: the draft, else what the server said, else `null` while loading. */
  shown: PoolLists | null
  /** A draft exists at all — the difference between "not editing" and "editing, nothing changed". */
  hasDraft: boolean
  dirty: boolean
  saving: boolean
  onChange: (lists: PoolLists) => void
  onPick: (kind: PoolKind, championId: number) => void
  onSave: () => void
  onDiscard: () => void
}

export function usePoolEditor(
  mine: PoolPersonDto | null,
  viewer: { id: string; role: 'captain' | 'member' } | null,
): PoolEditor {
  const save = useSavePool()
  const queryClient = useQueryClient()

  const [draft, setDraft] = useState<PoolLists | null>(null)

  const editing = mine !== null && canEditPool(viewer, mine.userId)
  const shown = draft ?? mine?.lists ?? null
  const dirty = mine !== null && isDirty(draft, mine.lists)
  const version = mine?.version ?? null

  // a new server version — our save, or somebody else's — makes the draft stale by definition
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the trigger, not a read
  useEffect(() => {
    setDraft(null)
  }, [version])

  const onSave = () => {
    if (!mine || !draft) return

    save.mutate(
      { version: mine.version, lists: draft },
      {
        onSuccess: () => {
          setDraft(null)
          notifications.show({ message: 'Pool saved', color: 'green' })
        },
        onError: (error) => {
          const failure = saveFailure(error)
          if (failure.reload) {
            // the stored pool won: drop the draft *and* refetch, because the cache still holds the
            // version we read — dropping alone would show the stale read as "the latest version"
            setDraft(null)
            void queryClient.invalidateQueries({ queryKey: POOLS_KEY })
          }
          notifications.show({ message: failure.message, color: failure.color })
        },
      },
    )
  }

  /** The `+` in a band opens its own popover; this only records the pick in the draft. */
  const onPick = (kind: PoolKind, championId: number) => {
    if (!shown) return
    setDraft(addChampion(shown, kind, championId))
  }

  return {
    editing,
    shown,
    hasDraft: draft !== null,
    dirty,
    saving: save.isPending,
    onChange: setDraft,
    onPick,
    onSave,
    onDiscard: () => setDraft(null),
  }
}
