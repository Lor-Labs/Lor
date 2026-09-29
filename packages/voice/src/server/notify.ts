import type { VoiceCallState } from "@repo/realtime-types/events"

export type VoiceNotifier = {
  presenceChanged: (workspaceId: string) => void
  callChanged: (userId: string, call: VoiceCallState | null) => void
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
