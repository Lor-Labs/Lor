import * as Notifications from "expo-notifications"
import { router } from "expo-router"
import { useEffect, useRef } from "react"
import { AppState } from "react-native"
import { useWorkspace } from "@/context/workspace-context"
import { authClient } from "@/lib/auth-client"
import { registerPushToken } from "@/lib/push-notifications"
import { parsePushTarget } from "@/lib/push-target"

// While the app is foregrounded the socket already renders messages and
// in-app badges, so any push that races through stays silent.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
})

export function usePushNotifications() {
  const { data: session } = authClient.useSession()
  const { workspace, isLoading, selectWorkspace } = useWorkspace()
  const registeredUserIdRef = useRef<string | null>(null)
  const handledResponseRef = useRef<string | null>(null)
  const lastResponse = Notifications.useLastNotificationResponse()
  const userId = session?.user.id
  const activeWorkspaceId = workspace?.id

  useEffect(() => {
    if (!userId) {
      registeredUserIdRef.current = null
      return
    }
    if (registeredUserIdRef.current === userId) return
    registeredUserIdRef.current = userId
    registerPushToken().catch(() => {
      registeredUserIdRef.current = null
    })
  }, [userId])

  useEffect(() => {
    if (!(lastResponse && userId) || isLoading) return
    if (
      lastResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER
    ) {
      return
    }
    const identifier = lastResponse.notification.request.identifier
    if (handledResponseRef.current === identifier) return
    handledResponseRef.current = identifier
    const clearResponse = () => {
      void Notifications.clearLastNotificationResponseAsync()
    }
    const retryResponseLater = () => {
      handledResponseRef.current = null
    }

    const target = parsePushTarget(
      lastResponse.notification.request.content.data ?? {}
    )
    if (!target) {
      clearResponse()
      return
    }

    void (async () => {
      if (target.kind === "instructions-proposal") {
        if (target.workspaceId !== activeWorkspaceId) {
          const switched = await selectWorkspace(target.workspaceId)
          if (!switched) {
            retryResponseLater()
            return
          }
        }
        router.push({
          pathname: "/settings/instructions",
          params: { workspaceSlug: target.workspaceSlug },
        } as never)
        clearResponse()
        return
      }
      if (target.workspaceId === null) {
        router.push({
          pathname: "/dm/[dmId]",
          params: {
            dmId: target.channelId,
            ...(target.messageId ? { focusMessageId: target.messageId } : {}),
          },
        } as never)
        clearResponse()
        return
      }
      if (target.workspaceId !== activeWorkspaceId) {
        const switched = await selectWorkspace(target.workspaceId)
        if (!switched) {
          retryResponseLater()
          return
        }
      }
      if (target.threadRootId) {
        router.push({
          pathname: "/channel/[channelId]/thread/[threadRootId]",
          params: {
            channelId: target.channelId,
            threadRootId: target.threadRootId,
            ...(target.messageId ? { focusMessageId: target.messageId } : {}),
            ...(target.tab ? { tab: target.tab } : {}),
          },
        } as never)
      } else {
        router.push({
          pathname: "/channel/[channelId]",
          params: {
            channelId: target.channelId,
            ...(target.messageId ? { focusMessageId: target.messageId } : {}),
          },
        } as never)
      }
      clearResponse()
    })()
  }, [lastResponse, userId, isLoading, activeWorkspaceId, selectWorkspace])

  useEffect(() => {
    const clearDelivered = () => {
      void Notifications.dismissAllNotificationsAsync()
      void Notifications.setBadgeCountAsync(0)
    }
    if (AppState.currentState === "active") clearDelivered()
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") clearDelivered()
    })
    return () => subscription.remove()
  }, [])
}
