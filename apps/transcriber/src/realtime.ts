import { readServerEnv } from "@repo/env/server-fields"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import { threadRoom, userRoom, workspaceRoom } from "@repo/realtime-types/rooms"
import { setVoiceNotifier } from "@repo/voice/server"
import { Emitter } from "@socket.io/redis-emitter"
import { createClient } from "redis"
import { logger } from "./logger"

const env = readServerEnv("REDIS_URL")

type RedisClient = ReturnType<typeof createClient>

// One per call (each job runs in its own process), connected on first use:
// most calls never address Lor.
let client: RedisClient | null = null
let emitter: Promise<Emitter<ServerToClientEvents>> | null = null

function getEmitter() {
  emitter ??= (async () => {
    const next = createClient({ url: env.REDIS_URL })
    next.on("error", (err) => logger.warn({ err }, "transcriber: redis error"))
    await next.connect()
    client = next
    return new Emitter<ServerToClientEvents>(next)
  })()
  return emitter
}

function publish(send: (io: Emitter<ServerToClientEvents>) => void) {
  void getEmitter()
    .then(send)
    .catch((err: unknown) =>
      logger.warn({ err }, "transcriber: realtime notify failed")
    )
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
        io
          .to(threadRoom(threadRootId))
          .emit("voice:request:updated", { request })
      ),
  })
}

export async function closeRealtime() {
  await client?.quit().catch(() => undefined)
}
