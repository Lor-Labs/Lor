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
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import {
  channelMutesQueryOptions,
  findActiveMute,
} from "@/hooks/use-channel-mutes"
import { useMessageSearchNavigation } from "@/hooks/use-message-search-navigation"
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
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const navigateToMessage = useMessageSearchNavigation()

  useEffect(() => {
    if (!socket) return

    // The sidebar keeps the workspace list loaded; notifications carry ids.
    const workspaceSlugFor = (workspaceId: string) =>
      queryClient
        .getQueryData<Array<{ id: string; slug: string }>>(["workspaces"])
        ?.find((workspace) => workspace.id === workspaceId)?.slug

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

      const workspaceSlug = payload.workspaceId
        ? workspaceSlugFor(payload.workspaceId)
        : undefined

      if (payload.callMention) {
        const { authorName, channelName } = payload.callMention
        showNotification(
          `${authorName} mentioned you in a call`,
          channelName ? `In #${channelName}` : "Join from the voice channel",
          {
            tag: `mention-${payload.messageId}`,
            // The call's chat is closed to them; land on Join.
            onClick: workspaceSlug
              ? () =>
                  void navigate({
                    to: "/$workspaceSlug/$channelId",
                    params: { workspaceSlug, channelId: payload.channelId },
                  })
              : undefined,
          }
        )
        return
      }

      const mentionType =
        payload.type === "everyone_mention" ? "@everyone" : "a mention"

      showNotification("New Mention", `You received ${mentionType}`, {
        tag: `mention-${payload.messageId}`,
        onClick: workspaceSlug
          ? () =>
              navigateToMessage({
                id: payload.messageId,
                channelId: payload.channelId,
                threadRootId: payload.threadRootId,
                workspaceSlug,
              })
          : undefined,
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
  }, [
    socket,
    settings,
    mutes,
    viewedChannelId,
    queryClient,
    navigate,
    navigateToMessage,
  ])
}
