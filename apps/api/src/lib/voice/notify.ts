import { threadRoom, userRoom, workspaceRoom } from "@repo/realtime-types/rooms"
import { setVoiceNotifier } from "@repo/voice/server"
import { getEmitter } from "@/lib/bot-messages"
import { logger } from "@/lib/logger"

type Emitter = Awaited<ReturnType<typeof getEmitter>>

function publish(send: (io: Emitter) => void) {
  void getEmitter()
    .then(send)
    .catch((err) => logger.warn({ err }, "voice: realtime notify failed"))
}

export function installVoiceNotifier() {
  setVoiceNotifier({
    presenceChanged: (workspaceId) =>
      publish((io) =>
        io
          .to(workspaceRoom(workspaceId))
          .emit("workspace:voice:updated", { workspaceId })
      ),
    callChanged: (userId, call) =>
      publish((io) =>
        io.to(userRoom(userId)).emit("voice:call:updated", { call })
      ),
    sessionChatChanged: (userId, threadRootId, inCall) =>
      publish((io) => {
        const sockets = io.in(userRoom(userId))
        if (inCall) sockets.socketsJoin(threadRoom(threadRootId))
        else sockets.socketsLeave(threadRoom(threadRootId))
      }),
    requestChanged: (threadRootId, request) =>
      publish((io) =>
        io.to(threadRoom(threadRootId)).emit("voice:request:updated", {
          request,
        })
      ),
  })
}
