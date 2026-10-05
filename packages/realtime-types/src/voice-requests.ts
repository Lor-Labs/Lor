import type { VoiceRequestState } from "./events"

// Lor's window rules, shared by web and mobile: which request it shows, and
// how live updates merge into a call's request list.

const ACTIVE_STATUSES: ReadonlySet<VoiceRequestState["status"]> = new Set([
  "listening",
  "queued",
  "working",
  "awaiting_approval",
])

export function isActiveVoiceRequest(
  request: Pick<VoiceRequestState, "status">
) {
  return ACTIVE_STATUSES.has(request.status)
}

export function hasVoiceResult(request: VoiceRequestState) {
  return request.status === "done" && request.result !== null
}

// Events from the transcriber, worker, and API can arrive out of order, so an
// older update never replaces a newer one. Rejected lines were never requests.
export function mergeVoiceRequest(
  list: VoiceRequestState[],
  request: VoiceRequestState
) {
  const existing = list.find((entry) => entry.id === request.id)
  if (existing && existing.updatedAt > request.updatedAt) return list
  const rest = list.filter((entry) => entry.id !== request.id)
  if (request.status === "rejected") return rest
  return [...rest, request].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  )
}

const time = (value: string | null) => (value ? Date.parse(value) : 0)

// When a request last took Lor's window: it was made, it finished, or
// someone staged it again.
const stageTime = (request: VoiceRequestState) =>
  Math.max(
    time(request.createdAt),
    time(request.finishedAt),
    time(request.stagedAt)
  )

// What Lor's window shows, from requests oldest first. A request in flight
// always does. Otherwise the request that most recently took the window,
// until it's cleared; a cancel takes the window and closes it, so it never
// brings back an earlier one. Requests that a later one replaced mid-run
// (done, no result) never show.
export function pickVoiceRequestOnStage(requests: VoiceRequestState[]) {
  const latest = requests.at(-1)
  if (latest && isActiveVoiceRequest(latest)) return latest
  let top: VoiceRequestState | null = null
  for (const request of requests) {
    if (request.status === "done" && !request.result) continue
    if (!top || stageTime(request) >= stageTime(top)) top = request
  }
  return top && top.status !== "cancelled" && !top.dismissedAt ? top : null
}
