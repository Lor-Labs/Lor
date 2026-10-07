import type { VoiceRequestState } from "@repo/realtime-types/events"

// Requests the dev-only Lor simulator plays through Lor's window. They never
// reach the server, so the hooks that fetch for a request skip them. Kept
// apart from the simulator, which imports those hooks.
export const SIMULATED_ID_PREFIX = "dev-sim-"

export function isSimulatedRequest(request: Pick<VoiceRequestState, "id">) {
  return request.id.startsWith(SIMULATED_ID_PREFIX)
}
