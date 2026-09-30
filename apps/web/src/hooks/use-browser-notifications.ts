import {
  type ApprovalNotification,
  buildApprovalNotificationContent,
  buildNotificationTitle,
  buildProposalNotificationContent,
  buildReactionNotificationBody,
  type MentionNotification,
  type ProposalNotification,
  type ReactionNotification,
  shouldNotifyForLorThread,
  type UnreadNotification,
} from "@repo/realtime-types"
import { useQuery } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
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
  lorThreadNotifications: "all_activity" | "subscribed_only"
}

/**
 * Fires browser/desktop notifications for incoming messages, mentions, and
 * reactions based on the user's notification preferences.
 * Suppressed only when the event is already on screen — see isAlreadyVisible.
 */
export function useBrowserNotifications() {
  const socket = useSocket()
  const { channelId, dmId } = useParams({ strict: false })
  const viewedChannelId = channelId ?? dmId ?? null
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

    // A focused window is not enough to assume the user saw it: sitting in
    // #general while a message lands in #test leaves only a sidebar badge,
    // which is easy to miss. Suppress only for the channel actually on screen.
    const isAlreadyVisible = (eventChannelId: string) =>
      document.hasFocus() && viewedChannelId === eventChannelId

    const onMention = (payload: MentionNotification) => {
      if (isAlreadyVisible(payload.channelId)) return
      if (!(settings && mutes)) return
      if (findActiveMute(mutes, payload.channelId)) return
      if (settings.desktopNotifications === "nothing") return
      // An explicit @-mention outrides the Lor-thread ambience preference;
      // only broadcast mentions stay subject to it.
      if (
        payload.type === "everyone_mention" &&
        !shouldNotifyForLorThread(settings.lorThreadNotifications, payload)
      ) {
        return
      }

      // For DM mentions, check dmNotifications setting
      if (
        payload.workspaceId === null &&
        settings.dmNotifications === "nothing"
      ) {
        return
      }

      if (payload.callMention) {
        const { authorName, channelName } = payload.callMention
        showNotification(
          `${authorName} mentioned you in a call`,
          channelName ? `In #${channelName}` : "Join from the voice channel",
          { tag: `mention-${payload.messageId}` }
        )
        return
      }

      const mentionType =
        payload.type === "everyone_mention" ? "@everyone" : "a mention"

      showNotification("New Mention", `You received ${mentionType}`, {
        tag: `mention-${payload.messageId}`,
      })
    }

    const onUnread = (payload: UnreadNotification) => {
      if (isAlreadyVisible(payload.channelId)) return
      if (!(settings && mutes)) return
      if (findActiveMute(mutes, payload.channelId)) return
      if (!shouldNotifyForLorThread(settings.lorThreadNotifications, payload)) {
        return
      }
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
      if (isAlreadyVisible(payload.channelId)) return
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

    // Directed approval pings (LOR-83): the server already narrowed the
    // audience to this user, so mutes and level settings deliberately don't
    // apply — only "nothing" and being on the channel already suppress it.
    const onApproval = (payload: ApprovalNotification) => {
      if (isAlreadyVisible(payload.channelId)) return
      if (settings?.desktopNotifications === "nothing") return
      const { title, body } = buildApprovalNotificationContent(payload)
      showNotification(title, body, { tag: `approval-${payload.approvalId}` })
    }

    // Same contract as approvals: the server already narrowed the audience to
    // people who can approve this proposal.
    const onProposal = (payload: ProposalNotification) => {
      if (isAlreadyVisible(payload.channelId)) return
      if (settings?.desktopNotifications === "nothing") return
      const { title, body } = buildProposalNotificationContent(payload)
      showNotification(title, body, { tag: `proposal-${payload.proposalId}` })
    }

    socket.on("notification:mention", onMention)
    socket.on("notification:unread", onUnread)
    socket.on("notification:reaction", onReaction)
    socket.on("notification:approval", onApproval)
    socket.on("notification:proposal", onProposal)

    return () => {
      socket.off("notification:mention", onMention)
      socket.off("notification:unread", onUnread)
      socket.off("notification:reaction", onReaction)
      socket.off("notification:approval", onApproval)
      socket.off("notification:proposal", onProposal)
    }
  }, [socket, settings, mutes, viewedChannelId])
}
