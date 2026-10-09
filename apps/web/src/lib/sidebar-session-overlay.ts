import type {
  ChannelActivity,
  RealtimeAgentSession,
  SidebarSession,
} from "@repo/realtime-types"
import { useSyncExternalStore } from "react"

// Optimistic sidebar session rows: archive, unarchive, rename, subscribe and
// unsubscribe show at once, before the next activity snapshot. An entry
// clears when a snapshot agrees with it, when its request fails, or after
// OVERLAY_TTL_MS so a lost update can't stick.
export type SessionOverlay =
  | { kind: "hide"; channelId: string }
  | { kind: "show"; channelId: string; row: SidebarSession }
  | { kind: "rename"; channelId: string; title: string }

const OVERLAY_TTL_MS = 20_000

let overlays: ReadonlyMap<string, SessionOverlay> = new Map()
const listeners = new Set<() => void>()

function publish(next: ReadonlyMap<string, SessionOverlay>) {
  overlays = next
  for (const listener of listeners) listener()
}

export function setSessionOverlay(
  sessionId: string,
  overlay: SessionOverlay | null
) {
  const next = new Map(overlays)
  if (overlay) next.set(sessionId, overlay)
  else next.delete(sessionId)
  publish(next)
  if (!overlay) return
  setTimeout(() => {
    if (overlays.get(sessionId) === overlay) setSessionOverlay(sessionId, null)
  }, OVERLAY_TTL_MS)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useSessionOverlays() {
  return useSyncExternalStore(subscribe, () => overlays)
}

// A row for a session the snapshot doesn't list yet (unarchive, subscribe).
export function sidebarRowFor(session: RealtimeAgentSession): SidebarSession {
  return {
    id: session.id,
    title: session.title,
    state: "idle",
    loop: session.loopId !== null,
    lastActivityAt: session.lastActivityAt,
  }
}

export function applySessionOverlays(
  channels: ChannelActivity[],
  current: ReadonlyMap<string, SessionOverlay>
): ChannelActivity[] {
  if (current.size === 0) return channels
  const byChannel = new Map(
    channels.map((channel) => [
      channel.channelId,
      {
        ...channel,
        sessions: channel.sessions.flatMap((session) => {
          const overlay = current.get(session.id)
          if (overlay?.kind === "hide") return []
          if (overlay?.kind === "rename") {
            return [{ ...session, title: overlay.title }]
          }
          return [session]
        }),
      },
    ])
  )
  for (const [sessionId, overlay] of current) {
    if (overlay.kind !== "show") continue
    const channel = byChannel.get(overlay.channelId) ?? {
      channelId: overlay.channelId,
      lor: null,
      sessions: [],
    }
    if (!channel.sessions.some((session) => session.id === sessionId)) {
      channel.sessions = [...channel.sessions, overlay.row]
    }
    byChannel.set(overlay.channelId, channel)
  }
  return [...byChannel.values()]
}

// Drops the entries a fresh snapshot already reflects.
export function settleSessionOverlays(channels: ChannelActivity[]) {
  if (overlays.size === 0) return
  const listed = new Map(
    channels.flatMap((channel) =>
      channel.sessions.map((session) => [session.id, session] as const)
    )
  )
  const next = new Map(overlays)
  for (const [sessionId, overlay] of overlays) {
    const row = listed.get(sessionId)
    const settled =
      overlay.kind === "hide"
        ? !row
        : overlay.kind === "show"
          ? Boolean(row)
          : row?.title === overlay.title
    if (settled) next.delete(sessionId)
  }
  if (next.size !== overlays.size) publish(next)
}
