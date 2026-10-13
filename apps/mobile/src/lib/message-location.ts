import { type Href, router } from "expo-router"
import { api } from "@/lib/api"

export type MessageLocation = {
  channelId: string
  threadRootId: string | null
  // Set when the message is in a Lor session.
  sessionId: string | null
}

// Where a message lives, for search results and pins. Null when it's gone
// or the caller can't see it.
export async function fetchMessageLocation(
  workspaceSlug: string,
  messageId: string
): Promise<MessageLocation | null> {
  try {
    const response = await api.v1.workspaces[":workspaceSlug"].messages[
      ":messageId"
    ].$get({ param: { workspaceSlug, messageId } })
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

// Opens a message where it lives: a Lor session opens as its page (its
// thread root is a hidden anchor a thread screen can't show), a thread as
// the thread, else the channel. `replace` swaps the current screen.
export function openMessageAt(
  location: MessageLocation,
  messageId: string,
  { replace = false }: { replace?: boolean } = {}
) {
  const href: Href = location.sessionId
    ? {
        pathname: "/session/[sessionId]",
        params: { sessionId: location.sessionId, focusMessageId: messageId },
      }
    : location.threadRootId
      ? {
          pathname: "/channel/[channelId]/thread/[threadRootId]",
          params: {
            channelId: location.channelId,
            threadRootId: location.threadRootId,
            focusMessageId: messageId,
          },
        }
      : {
          pathname: "/channel/[channelId]",
          params: { channelId: location.channelId, focusMessageId: messageId },
        }
  if (replace) router.replace(href)
  else router.push(href)
}
