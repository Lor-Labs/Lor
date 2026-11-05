import { authClient } from "@repo/auth/client"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useCallback, useSyncExternalStore } from "react"
import { webOrigin } from "@/lib/web-origin"

// A code session's tabs beside the chat (reference/planned/code-sessions-runbook.md,
// 3b): the open tabs per person per session in local storage, the active one
// in the URL (?open=file:<path>, diff:<path> or changes; none is the Chat
// tab).

export const CHANGES_TAB_ID = "changes"
export type SessionTab =
  | { id: string; kind: "file" | "diff"; path: string }
  | { id: typeof CHANGES_TAB_ID; kind: "changes" }

export const fileTabId = (path: string) => `file:${path}`
export const diffTabId = (path: string) => `diff:${path}`

export function parseTabId(id: string): SessionTab | null {
  if (id === CHANGES_TAB_ID) return { id, kind: "changes" }
  const colon = id.indexOf(":")
  if (colon < 0) return null
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

  // `at`: the file the All changes tab scrolls to.
  const select = useCallback(
    (id: string | null, at?: string) =>
      void navigate({
        to: ".",
        search: (prev) => ({ ...prev, open: id ?? undefined, at }),
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

  // The All changes tab, scrolled to one file's diff.
  const openChange = useCallback(
    (path: string) => {
      addTab(key, CHANGES_TAB_ID, false)
      select(CHANGES_TAB_ID, path)
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

  // Closing the active tab shows its neighbor, or the Chat tab. Closing All
  // changes always goes back to Chat.
  const close = useCallback(
    (id: string) => {
      const current = readTabs(key)
      const index = current.ids.indexOf(id)
      const ids = current.ids.filter((tab) => tab !== id)
      writeTabs(key, {
        ids,
        preview: current.preview === id ? null : current.preview,
      })
      if (active !== id) return
      select(
        id === CHANGES_TAB_ID
          ? null
          : (ids[Math.min(index, ids.length - 1)] ?? null)
      )
    },
    [key, active, select]
  )

  // Diffs of files a commit left unchanged; the Chat tab if one was active.
  const closeDiffs = useCallback(
    (keepPaths: Set<string>) => {
      const current = readTabs(key)
      const stale = (id: string) => {
        const tab = parseTabId(id)
        return tab?.kind === "diff" && !keepPaths.has(tab.path)
      }
      const ids = current.ids.filter((id) => !stale(id))
      if (ids.length === current.ids.length) return
      writeTabs(key, {
        ids,
        preview:
          current.preview && stale(current.preview) ? null : current.preview,
      })
      if (active && stale(active)) select(null)
    },
    [key, active, select]
  )

  // Keeps only `id`; null (the Chat tab) closes every tab.
  const closeOthers = useCallback(
    (id: string | null) => {
      const current = readTabs(key)
      writeTabs(key, {
        ids: id ? [id] : [],
        preview: current.preview === id ? id : null,
      })
      if (active !== id) select(id)
    },
    [key, active, select]
  )

  // The next (1) or previous (-1) tab, Chat included, wrapping around.
  const cycle = useCallback(
    (step: 1 | -1) => {
      const order = [null, ...readTabs(key).ids]
      const index = Math.max(order.indexOf(active), 0)
      select(order[(index + step + order.length) % order.length] ?? null)
    },
    [key, active, select]
  )

  return {
    ids: state.ids,
    preview: state.preview,
    active,
    select,
    open,
    openChange,
    adopt,
    keep,
    close,
    closeDiffs,
    closeOthers,
    cycle,
  }
}

// A tab's link for other people: the web app's address, never the desktop
// app's tauri:// one.
export function sessionTabLink(
  workspaceSlug: string,
  sessionId: string,
  id: string | null
) {
  const base = `${webOrigin()}/${workspaceSlug}/session/${sessionId}`
  return id ? `${base}?open=${encodeURIComponent(id)}` : base
}

export type SessionTabs = ReturnType<typeof useSessionTabs>
