import {
  buildNotificationTitle,
  buildReactionNotificationBody,
  type MentionNotification,
  type ReactionNotification,
  type UnreadNotification,
} from "@repo/realtime-types"
import { useQuery } from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import {
  channelMutesQueryOptions,
  findActiveMute,
} from "@/hooks/use-channel-mutes"
import { apiClient } from "@/lib/api-client"
import { showNotification } from "@/lib/notification-dispatcher"

type NotificationSettings = {
  desktopNotifications: "all_messages" | "mentions_only" | "nothing"
  dmNotifications: "all_messages" | "nothing"
}

/**
 * Fires browser/desktop notifications for incoming messages and mentions
 * based on user's notification preferences.
 * Only fires when the tab is not focused.
 */
export function useBrowserNotifications() {
  const socket = useSocket()
  const { data: settings } = useQuery({
    queryKey: ["notification-settings"],
    queryFn: async () => {
      const res = await apiClient.v1["notification-settings"].$get()
      if (!res.ok) throw new Error("Failed to fetch notification settings")
      return res.json() as Promise<NotificationSettings>
    },
  })
  const { data: mutes } = useQuery(channelMutesQueryOptions)

  useEffect(() => {
    if (!socket) return

    const onMention = (payload: MentionNotification) => {
      if (document.hasFocus()) return
      if (!(settings && mutes)) return
      if (findActiveMute(mutes, payload.channelId)) return
      if (settings.desktopNotifications === "nothing") return

      // For DM mentions, check dmNotifications setting
      if (
        payload.workspaceId === null &&
        settings.dmNotifications === "nothing"
      ) {
        return
      }

      const mentionType =
        payload.type === "everyone_mention" ? "@everyone" : "a mention"

      showNotification("New Mention", `You received ${mentionType}`, {
        tag: `mention-${payload.messageId}`,
      })
    }

    const onUnread = (payload: UnreadNotification) => {
      if (document.hasFocus()) return
      if (!(settings && mutes)) return
      if (findActiveMute(mutes, payload.channelId)) return
      const enabled =
        payload.workspaceId === null
          ? settings.dmNotifications === "all_messages"
          : settings.desktopNotifications === "all_messages"
      if (!enabled) return

      showNotification(
        buildNotificationTitle({
          actorName: payload.authorName,
          channelName: payload.channelName,
          workspaceName: payload.workspaceName,
        }),
        payload.contentPreview ?? "Sent a message",
        {
          tag: `unread-${payload.channelId}`,
          icon: payload.authorImage,
        }
      )
    }

    const onReaction = (payload: ReactionNotification) => {
      if (document.hasFocus()) return
      if (!(settings && mutes)) return
      if (findActiveMute(mutes, payload.channelId)) return
      const enabled =
        payload.workspaceId === null
          ? settings.dmNotifications === "all_messages"
          : settings.desktopNotifications === "all_messages"
      if (!enabled) return

      showNotification(
        buildNotificationTitle({
          actorName: payload.actorName,
          channelName: payload.channelName,
          workspaceName: payload.workspaceName,
        }),
        buildReactionNotificationBody(payload),
        {
          tag: `reaction-${payload.messageId}-${payload.emoji}`,
          icon: payload.actorImage,
        }
      )
    }

    socket.on("notification:mention", onMention)
    socket.on("notification:unread", onUnread)
    socket.on("notification:reaction", onReaction)

    return () => {
      socket.off("notification:mention", onMention)
      socket.off("notification:unread", onUnread)
      socket.off("notification:reaction", onReaction)
    }
  }, [socket, settings, mutes])
}
