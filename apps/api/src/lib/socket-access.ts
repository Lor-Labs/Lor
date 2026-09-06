import {
  type ServerToClientEvents,
  userConnectionRoom,
  userRoom,
} from "@repo/realtime-types"
import { Emitter } from "@socket.io/redis-emitter"
import { getRedisClient } from "@/lib/redis"

export async function disconnectUserSockets(userId: string) {
  const redis = await getRedisClient()
  const publishes: Promise<number>[] = []
  // Await the security command's publish; redis-emitter otherwise discards it.
  const emitter = new Emitter<ServerToClientEvents>({
    publish(channel: string, message: string | Buffer) {
      const result = redis.publish(channel, message)
      publishes.push(result)
      return result
    },
  })
  emitter
    .to([userConnectionRoom(userId), userRoom(userId)])
    .disconnectSockets(true)
  await Promise.all(publishes)
}
