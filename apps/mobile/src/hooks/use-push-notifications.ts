import * as Notifications from "expo-notifications"
import { router } from "expo-router"
import { useEffect, useRef } from "react"
import { AppState } from "react-native"
import { useWorkspace } from "@/context/workspace-context"
import { authClient } from "@/lib/auth-client"
import { registerPushToken } from "@/lib/push-notifications"

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

type PushTarget =
  | {
      kind: "message"
      channelId: string
      workspaceId: string | null
      threadRootId: string | null
    }
  | {
      kind: "instructions-proposal"
      workspaceId: string
      workspaceSlug: string
    }

function parsePushTarget(data: Record<string, unknown>): PushTarget | null {
  if (data.type === "instructions-proposal") {
    const workspaceId =
      typeof data.workspaceId === "string" ? data.workspaceId : null
    const workspaceSlug =
      typeof data.workspaceSlug === "string" ? data.workspaceSlug : null
    if (!workspaceId || !workspaceSlug) return null
    return { kind: "instructions-proposal", workspaceId, workspaceSlug }
  }
  const channelId = typeof data.channelId === "string" ? data.channelId : null
  if (!channelId) return null
  return {
    kind: "message",
    channelId,
    workspaceId: typeof data.workspaceId === "string" ? data.workspaceId : null,
    threadRootId:
      typeof data.threadRootId === "string" ? data.threadRootId : null,
  }
}

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
    void Notifications.clearLastNotificationResponseAsync()

    const target = parsePushTarget(
      lastResponse.notification.request.content.data ?? {}
    )
    if (!target) return

    void (async () => {
      if (target.kind === "instructions-proposal") {
        if (target.workspaceId !== activeWorkspaceId) {
          const switched = await selectWorkspace(target.workspaceId)
          if (!switched) return
        }
        router.push({
          pathname: "/settings/instructions",
          params: { workspaceSlug: target.workspaceSlug },
        } as never)
        return
      }
      if (target.workspaceId === null) {
        router.push({
          pathname: "/dm/[dmId]",
          params: { dmId: target.channelId },
        } as never)
        return
      }
      if (target.workspaceId !== activeWorkspaceId) {
        const switched = await selectWorkspace(target.workspaceId)
        if (!switched) return
      }
      if (target.threadRootId) {
        router.push({
          pathname: "/channel/[channelId]/thread/[threadRootId]",
          params: {
            channelId: target.channelId,
            threadRootId: target.threadRootId,
          },
        } as never)
      } else {
        router.push({
          pathname: "/channel/[channelId]",
          params: { channelId: target.channelId },
        } as never)
      }
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
