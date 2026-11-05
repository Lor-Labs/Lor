import type { SessionPanelView } from "@/components/sidebar/right-panel/right-sidebar-types"

// How a person left a session, on this device, so going back restores it: the
// side panel's tab and whether it was open, the code session's active tab
// beside the chat, and the Browser tab's last page. Per person; cleared on
// sign-out.
export type SessionPanelMemory = {
  type?: SessionPanelView["type"]
  collapsed?: boolean
  // A useSessionTabs id; null is the Chat tab.
  tab?: string | null
  browser?: { port: number; path: string }
}

const PREFIX = "lor-session-panel:"
const key = (userId: string, sessionId: string) =>
  `${PREFIX}${userId}:${sessionId}`

// A page's address can carry credentials (?token=, ?code=): never stored.
const SENSITIVE_PARAM =
  /token|secret|password|passwd|key|auth|code|session|sig/i

function safePath(path: string): string {
  try {
    const url = new URL(path, "http://sandbox")
    for (const name of [...url.searchParams.keys()]) {
      if (SENSITIVE_PARAM.test(name)) url.searchParams.delete(name)
    }
    return `${url.pathname}${url.search}`
  } catch {
    return "/"
  }
}

function withSafeBrowser(memory: SessionPanelMemory): SessionPanelMemory {
  return memory.browser
    ? {
        ...memory,
        browser: { ...memory.browser, path: safePath(memory.browser.path) },
      }
    : memory
}

export function readSessionPanel(
  userId: string | undefined,
  sessionId: string
): SessionPanelMemory {
  if (!userId) return {}
  try {
    const stored = JSON.parse(
      localStorage.getItem(key(userId, sessionId)) ?? "{}"
    )
    return withSafeBrowser(stored ?? {})
  } catch {
    return {}
  }
}

export function writeSessionPanel(
  userId: string | undefined,
  sessionId: string,
  patch: SessionPanelMemory
) {
  if (!userId) return
  try {
    localStorage.setItem(
      key(userId, sessionId),
      JSON.stringify(
        withSafeBrowser({ ...readSessionPanel(userId, sessionId), ...patch })
      )
    )
  } catch {}
}

// Sign-out: this person's entries, plus unscoped ones from before entries
// were per person (`lor-session-panel:<sessionId>`).
export function clearSessionPanels(userId: string | undefined) {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const stored = localStorage.key(i)
      if (!stored?.startsWith(PREFIX)) continue
      const rest = stored.slice(PREFIX.length)
      if (!rest.includes(":") || (userId && rest.startsWith(`${userId}:`))) {
        localStorage.removeItem(stored)
      }
    }
  } catch {}
}
