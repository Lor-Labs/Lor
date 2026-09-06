import { userConnectionRoom, userRoom } from "@repo/realtime-types"
import { publishRealtime } from "@/lib/bot-messages"

export async function disconnectUserSockets(userId: string) {
  await publishRealtime((io) => {
    io.to([userConnectionRoom(userId), userRoom(userId)]).disconnectSockets(
      true
    )
  })
}
