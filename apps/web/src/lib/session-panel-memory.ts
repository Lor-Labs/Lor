import type { SessionPanelView } from "@/components/sidebar/right-panel/right-sidebar-types"

// How a person left a session, on this device, so going back restores it: the
// side panel's tab and whether it was open, the code session's active tab
// beside the chat, and the Browser tab's last page.
export type SessionPanelMemory = {
  type?: SessionPanelView["type"]
  collapsed?: boolean
  // A useSessionTabs id; null is the Chat tab.
  tab?: string | null
  browser?: { port: number; path: string }
}

const key = (sessionId: string) => `lor-session-panel:${sessionId}`

export function readSessionPanel(sessionId: string): SessionPanelMemory {
  try {
    return JSON.parse(localStorage.getItem(key(sessionId)) ?? "{}") ?? {}
  } catch {
    return {}
  }
}

export function writeSessionPanel(
  sessionId: string,
  patch: SessionPanelMemory
) {
  try {
    localStorage.setItem(
      key(sessionId),
      JSON.stringify({ ...readSessionPanel(sessionId), ...patch })
    )
  } catch {}
}
