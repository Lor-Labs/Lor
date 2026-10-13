// Persisted "where the user last was" so login returns them there instead of
// dropping them in DMs. Single source of truth for these localStorage keys.

const LAST_WORKSPACE_KEY = "lor:last-workspace-slug"
const lastChannelKey = (workspaceSlug: string) =>
  `last-channel:${workspaceSlug}`
const lastSessionKey = (workspaceSlug: string) =>
  `last-session:${workspaceSlug}`

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // ignore quota / private-mode failures
  }
}

function safeRemove(key: string) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(key)
  } catch {}
}

export function readLastWorkspaceSlug(): string | null {
  return safeGet(LAST_WORKSPACE_KEY)
}

export function writeLastWorkspaceSlug(workspaceSlug: string) {
  safeSet(LAST_WORKSPACE_KEY, workspaceSlug)
}

export function readLastChannelId(workspaceSlug: string): string | null {
  return safeGet(lastChannelKey(workspaceSlug))
}

// Visiting a channel replaces a remembered session as "where they were".
export function writeLastChannelId(workspaceSlug: string, channelId: string) {
  safeSet(lastChannelKey(workspaceSlug), channelId)
  safeRemove(lastSessionKey(workspaceSlug))
}

export function readLastSessionId(workspaceSlug: string): string | null {
  return safeGet(lastSessionKey(workspaceSlug))
}

// A session also counts as being in its channel, so New session preselects it.
export function writeLastSession(
  workspaceSlug: string,
  sessionId: string,
  channelId: string
) {
  safeSet(lastChannelKey(workspaceSlug), channelId)
  safeSet(lastSessionKey(workspaceSlug), sessionId)
}

export function clearLastSessionId(workspaceSlug: string) {
  safeRemove(lastSessionKey(workspaceSlug))
}
