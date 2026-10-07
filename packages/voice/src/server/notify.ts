import type {
  VoiceCallState,
  VoiceRequestActivity,
  VoiceRequestReaction,
  VoiceRequestState,
} from "@repo/realtime-types/events"

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
  requestChanged: (threadRootId: string, request: VoiceRequestState) => void
  // Queues the after-call summary and indexing. Hosts that end sessions (API,
  // worker) install it; the audit sweep catches a call whose queueing failed.
  sessionEnded?: (sessionId: string) => void
  // Only the worker, which runs requests, sends these.
  requestActivity?: (
    threadRootId: string,
    activity: VoiceRequestActivity
  ) => void
  requestReaction?: (
    threadRootId: string,
    reaction: VoiceRequestReaction
  ) => void
}

// Hosts (API, worker, transcriber) install their Socket.IO emitter at startup
// so this package stays transport-free.
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

export function notifyVoiceRequest(
  threadRootId: string,
  request: VoiceRequestState
) {
  try {
    notifier?.requestChanged(threadRootId, request)
  } catch {
    // swallow: delivery is best-effort by design
  }
}

export function notifyVoiceSessionEnded(sessionId: string) {
  try {
    notifier?.sessionEnded?.(sessionId)
  } catch {
    // swallow: the audit sweep queues calls this missed
  }
}

export function notifyVoiceRequestActivity(
  threadRootId: string,
  activity: VoiceRequestActivity
) {
  try {
    notifier?.requestActivity?.(threadRootId, activity)
  } catch {
    // swallow: delivery is best-effort by design
  }
}

export function notifyVoiceRequestReaction(
  threadRootId: string,
  reaction: VoiceRequestReaction
) {
  try {
    notifier?.requestReaction?.(threadRootId, reaction)
  } catch {
    // swallow: delivery is best-effort by design
  }
}
