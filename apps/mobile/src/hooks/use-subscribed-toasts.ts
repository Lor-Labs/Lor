import {
  buildSubscribedNotificationContent,
  type SubscribedNotification,
} from "@repo/realtime-types"
import { router } from "expo-router"
import { useToast } from "heroui-native/toast"
import { useEffect, useRef } from "react"
import { useSocket } from "@/context/socket-context"
import { useWorkspace } from "@/context/workspace-context"

// Someone added you to a session or thread while the app is open: a toast
// with Open (web shows an OS notification). Offline, the server sends the
// push instead (sendSubscribedPush).
export function useSubscribedToasts() {
  const socket = useSocket()
  const { toast } = useToast()
  const { workspace } = useWorkspace()
  const workspaceIdRef = useRef(workspace?.id)
  workspaceIdRef.current = workspace?.id

  useEffect(() => {
    if (!socket) return
    const open = (notification: SubscribedNotification) => {
      if (notification.sessionId) {
        router.push({
          pathname: "/session/[sessionId]",
          params: { sessionId: notification.sessionId },
        })
        return
      }
      router.push({
        pathname: "/channel/[channelId]/thread/[threadRootId]",
        params: {
          channelId: notification.channelId,
          threadRootId: notification.threadRootId,
        },
      })
    }
    const onSubscribed = (notification: SubscribedNotification) => {
      const { title, body } = buildSubscribedNotificationContent(notification)
      // Another workspace's thread can't open from here.
      const canOpen = notification.workspaceId === workspaceIdRef.current
      toast.show({
        label: title,
        description: body,
        ...(canOpen
          ? {
              actionLabel: "Open",
              onActionPress: ({ hide }) => {
                hide("all")
                open(notification)
              },
            }
          : {}),
      })
    }
    socket.on("notification:subscribed", onSubscribed)
    return () => {
      socket.off("notification:subscribed", onSubscribed)
    }
  }, [socket, toast])
}
