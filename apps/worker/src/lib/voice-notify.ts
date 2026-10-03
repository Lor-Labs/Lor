import type { ServerToClientEvents } from "@repo/realtime-types/events"
import { threadRoom, userRoom, workspaceRoom } from "@repo/realtime-types/rooms"
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
    sessionChatChanged: (userId, threadRootId, inCall) => {
      const sockets = emitter.in(userRoom(userId))
      if (inCall) sockets.socketsJoin(threadRoom(threadRootId))
      else sockets.socketsLeave(threadRoom(threadRootId))
    },
    requestChanged: (threadRootId, request) =>
      emitter
        .to(threadRoom(threadRootId))
        .emit("voice:request:updated", { request }),
    requestActivity: (threadRootId, activity) =>
      emitter
        .to(threadRoom(threadRootId))
        .emit("voice:request:activity", activity),
    requestReaction: (threadRootId, reaction) =>
      emitter
        .to(threadRoom(threadRootId))
        .emit("voice:request:reaction", reaction),
  })
}
