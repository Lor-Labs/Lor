import { authClient } from "@repo/auth/client"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useCallback, useSyncExternalStore } from "react"

// A code session's tabs beside the chat (reference/planned/code-sessions-runbook.md,
// 3b): the open tabs per person per session in local storage, the active one
// in the URL (?open=file:<path> or diff:<path>; none is the Agent tab).

export type SessionTab = { id: string; kind: "file" | "diff"; path: string }

export const fileTabId = (path: string) => `file:${path}`
export const diffTabId = (path: string) => `diff:${path}`

export function parseTabId(id: string): SessionTab | null {
  const colon = id.indexOf(":")
  const kind = id.slice(0, colon)
  const path = id.slice(colon + 1)
  if (!path || (kind !== "file" && kind !== "diff")) return null
  return { id, kind, path }
}

type TabState = {
  ids: string[]
  // The preview tab: the next single-click open replaces it.
  preview: string | null
}

const EMPTY: TabState = { ids: [], preview: null }
const states = new Map<string, TabState>()
const listeners = new Map<string, Set<() => void>>()

function readTabs(key: string | null): TabState {
  if (!key) return EMPTY
  const cached = states.get(key)
  if (cached) return cached
  let state = EMPTY
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? "null")
    if (stored && Array.isArray(stored.ids)) {
      const ids = stored.ids.filter(
        (id: unknown): id is string =>
          typeof id === "string" && parseTabId(id) !== null
      )
      state = {
        ids,
        preview: ids.includes(stored.preview) ? stored.preview : null,
      }
    }
  } catch {}
  states.set(key, state)
  return state
}

function writeTabs(key: string | null, state: TabState) {
  if (!key) return
  states.set(key, state)
  try {
    if (state.ids.length > 0) localStorage.setItem(key, JSON.stringify(state))
    else localStorage.removeItem(key)
  } catch {}
  for (const listener of listeners.get(key) ?? []) listener()
}

function subscribeTabs(key: string | null, listener: () => void) {
  if (!key) return () => {}
  const set = listeners.get(key) ?? new Set()
  set.add(listener)
  listeners.set(key, set)
  return () => {
    set.delete(listener)
  }
}

// A single click opens a preview tab, reusing the current one; a double
// click keeps it.
function addTab(key: string | null, id: string, preview: boolean) {
  const current = readTabs(key)
  if (current.ids.includes(id)) {
    if (!preview && current.preview === id) {
      writeTabs(key, { ...current, preview: null })
    }
  } else if (preview && current.preview) {
    writeTabs(key, {
      ids: current.ids.map((tab) => (tab === current.preview ? id : tab)),
      preview: id,
    })
  } else {
    writeTabs(key, {
      ids: [...current.ids, id],
      preview: preview ? id : current.preview,
    })
  }
}

export function useSessionTabs(sessionId: string) {
  const { data: auth } = authClient.useSession()
  // Null until the person is known: nothing is read or written.
  const key = auth ? `lor-session-tabs:${auth.user.id}:${sessionId}` : null
  const state = useSyncExternalStore(
    useCallback((listener) => subscribeTabs(key, listener), [key]),
    () => readTabs(key)
  )
  const active =
    useSearch({ strict: false, select: (search) => search.open }) ?? null
  const navigate = useNavigate()

  const select = useCallback(
    (id: string | null) =>
      void navigate({
        to: ".",
        search: (prev) => ({ ...prev, open: id ?? undefined }),
        replace: true,
      }),
    [navigate]
  )

  const open = useCallback(
    (id: string, { preview = true }: { preview?: boolean } = {}) => {
      addTab(key, id, preview)
      select(id)
    },
    [key, select]
  )

  // A reloaded or shared link's tab joins the list.
  const adopt = useCallback((id: string) => addTab(key, id, true), [key])

  const keep = useCallback(
    (id: string) => {
      const current = readTabs(key)
      if (current.preview === id) writeTabs(key, { ...current, preview: null })
    },
    [key]
  )

  // Closing the active tab shows its neighbor, or the Agent tab.
  const close = useCallback(
    (id: string) => {
      const current = readTabs(key)
      const index = current.ids.indexOf(id)
      const ids = current.ids.filter((tab) => tab !== id)
      writeTabs(key, {
        ids,
        preview: current.preview === id ? null : current.preview,
      })
      if (active === id) select(ids[Math.min(index, ids.length - 1)] ?? null)
    },
    [key, active, select]
  )

  return {
    ids: state.ids,
    preview: state.preview,
    active,
    select,
    open,
    adopt,
    keep,
    close,
  }
}

export type SessionTabs = ReturnType<typeof useSessionTabs>
