import type { ServerToClientEvents } from "@repo/realtime-types/events"
import { userRoom, workspaceRoom } from "@repo/realtime-types/rooms"
import { setVoiceNotifier } from "@repo/voice/server"
import type { Emitter } from "@socket.io/redis-emitter"

export function installVoiceNotifier(emitter: Emitter<ServerToClientEvents>) {
  setVoiceNotifier({
    presenceChanged: (workspaceId) =>
      emitter
        .to(workspaceRoom(workspaceId))
        .emit("workspace:voice:updated", { workspaceId }),
    callChanged: (userId, call) =>
      emitter.to(userRoom(userId)).emit("voice:call:updated", { call }),
  })
}
