import { router } from "expo-router"
import { Alert } from "react-native"
import { api } from "@/lib/api"

async function findCallChat(sessionId: string) {
  const res = await api.v1.voice.sessions[":sessionId"].$get({
    param: { sessionId },
  })
  if (!res.ok) return null
  const { channelId, session } = await res.json()
  return session.threadRootId
    ? { channelId, threadRootId: session.threadRootId }
    : null
}

// A Lor [[call:…]] citation. The phone has no transcript view yet
// (reference/mobile-parity-todo.md), so it opens the call's chat, where Lor
// posted the recap.
export async function openCitedCall(sessionId: string) {
  const chat = await findCallChat(sessionId).catch(() => null)
  if (!chat) {
    Alert.alert(
      "Call unavailable",
      "This call may have been deleted, or you may not have access to its channel."
    )
    return
  }
  router.push({
    pathname: "/channel/[channelId]/thread/[threadRootId]",
    params: chat,
  } as never)
}
