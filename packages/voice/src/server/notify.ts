import type { VoiceCallState } from "@repo/realtime-types/events"

export type VoiceNotifier = {
  presenceChanged: (workspaceId: string) => void
  callChanged: (userId: string, call: VoiceCallState | null) => void
  // Moves the person's sockets into or out of a live session chat's thread
  // room as they join or leave the call.
  sessionChatChanged: (
    userId: string,
    threadRootId: string,
    inCall: boolean
  ) => void
}

// Hosts (API, worker) install their Socket.IO emitter at startup so this
// package stays transport-free.
let notifier: VoiceNotifier | null = null

export function setVoiceNotifier(next: VoiceNotifier) {
  notifier = next
}

// Best-effort: clients refetch on receipt and the voice sync jobs converge
// state, so a failed publish must never fail the state change behind it.
export function notifyVoicePresence(workspaceId: string) {
  try {
    notifier?.presenceChanged(workspaceId)
  } catch {
    // swallow: delivery is best-effort by design
  }
}

export function notifyVoiceCall(userId: string, call: VoiceCallState | null) {
  try {
    notifier?.callChanged(userId, call)
  } catch {
    // swallow: delivery is best-effort by design
  }
}

export function notifySessionChat(
  userId: string,
  threadRootId: string,
  inCall: boolean
) {
  try {
    notifier?.sessionChatChanged(userId, threadRootId, inCall)
  } catch {
    // swallow: delivery is best-effort by design
  }
}
