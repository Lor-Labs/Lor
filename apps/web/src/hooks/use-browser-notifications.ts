import {
  type ApprovalNotification,
  buildApprovalNotificationContent,
  buildCallSummaryNotificationContent,
  buildNotificationTitle,
  buildProposalNotificationContent,
  buildReactionNotificationBody,
  buildSubscribedNotificationContent,
  type CallSummaryNotification,
  type MentionNotification,
  type ProposalNotification,
  type ReactionNotification,
  type SubscribedNotification,
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
}

/**
 * Fires browser/desktop notifications for incoming messages, mentions, and
 * reactions based on the user's notification preferences.
 * Suppressed only when the event is already on screen — see isAlreadyVisible.
 */
export function useBrowserNotifications() {
  const socket = useSocket()
  const { channelId, dmId, sessionId } = useParams({ strict: false })
  const viewedChannelId = channelId ?? dmId ?? null
  const viewedSessionId = sessionId ?? null
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
    // which is easy to miss. Suppress only for the channel (or the Lor
    // session) actually on screen.
    const isAlreadyVisible = (
      eventChannelId: string,
      eventSessionId?: string | null
    ) =>
      document.hasFocus() &&
      (eventSessionId
        ? viewedSessionId === eventSessionId
        : viewedChannelId === eventChannelId)
    const openSession = (workspaceSlug: string, sessionId: string) =>
      void navigate({
        to: "/$workspaceSlug/session/$sessionId",
        params: { workspaceSlug, sessionId },
      })

    const onMention = (payload: MentionNotification) => {
      if (isAlreadyVisible(payload.channelId, payload.sessionId)) return
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
          ? () => {
              const { sessionId } = payload
              if (sessionId) return openSession(workspaceSlug, sessionId)
              navigateToMessage({
                id: payload.messageId,
                channelId: payload.channelId,
                threadRootId: payload.threadRootId,
                workspaceSlug,
              })
            }
          : undefined,
      })
    }

    const onUnread = (payload: UnreadNotification) => {
      if (isAlreadyVisible(payload.channelId, payload.sessionId)) return
      if (!(settings && mutes)) return
      if (findActiveMute(mutes, payload.channelId)) return
      // The server decides: thread messages notify only their subscribers.
      if (!payload.notify) return
      const enabled =
        payload.workspaceId === null
          ? settings.dmNotifications === "all_messages"
          : settings.desktopNotifications === "all_messages"
      if (!enabled) return

      const { sessionId } = payload
      const workspaceSlug = payload.workspaceId
        ? workspaceSlugFor(payload.workspaceId)
        : undefined
      showNotification(
        buildNotificationTitle({
          actorName: payload.authorName,
          channelName: payload.channelName,
          workspaceName: payload.workspaceName,
        }),
        payload.contentPreview ?? "Sent a message",
        {
          tag: sessionId
            ? `unread-session-${sessionId}`
            : `unread-${payload.channelId}`,
          icon: payload.authorImage,
          onClick:
            sessionId && workspaceSlug
              ? () => openSession(workspaceSlug, sessionId)
              : undefined,
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

    // Being added as a subscriber notifies like a mention.
    const onSubscribed = (payload: SubscribedNotification) => {
      if (isAlreadyVisible(payload.channelId, payload.sessionId)) return
      if (!(settings && mutes)) return
      if (findActiveMute(mutes, payload.channelId)) return
      if (settings.desktopNotifications === "nothing") return

      const workspaceSlug = workspaceSlugFor(payload.workspaceId)
      const { title, body } = buildSubscribedNotificationContent(payload)
      showNotification(title, body, {
        tag: `subscribed-${payload.threadRootId}`,
        onClick: workspaceSlug
          ? () => {
              const { sessionId } = payload
              if (sessionId) return openSession(workspaceSlug, sessionId)
              navigateToMessage({
                id: payload.threadRootId,
                channelId: payload.channelId,
                threadRootId: payload.threadRootId,
                workspaceSlug,
              })
            }
          : undefined,
      })
    }

    // Lor summarized a call this person was in. Opening the call's chat root
    // lands on its Summary tab.
    const onCallSummary = (payload: CallSummaryNotification) => {
      if (isAlreadyVisible(payload.channelId)) return
      if (!(settings && mutes)) return
      if (findActiveMute(mutes, payload.channelId)) return
      if (settings.desktopNotifications === "nothing") return

      const workspaceSlug = workspaceSlugFor(payload.workspaceId)
      const { title, body } = buildCallSummaryNotificationContent(payload)
      showNotification(title, body, {
        tag: `call-summary-${payload.sessionId}`,
        onClick: workspaceSlug
          ? () =>
              navigateToMessage({
                id: payload.threadRootId,
                channelId: payload.channelId,
                threadRootId: payload.threadRootId,
                workspaceSlug,
              })
          : undefined,
      })
    }

    socket.on("notification:mention", onMention)
    socket.on("notification:unread", onUnread)
    socket.on("notification:reaction", onReaction)
    socket.on("notification:approval", onApproval)
    socket.on("notification:proposal", onProposal)
    socket.on("notification:subscribed", onSubscribed)
    socket.on("notification:call-summary", onCallSummary)

    return () => {
      socket.off("notification:mention", onMention)
      socket.off("notification:unread", onUnread)
      socket.off("notification:reaction", onReaction)
      socket.off("notification:approval", onApproval)
      socket.off("notification:proposal", onProposal)
      socket.off("notification:subscribed", onSubscribed)
      socket.off("notification:call-summary", onCallSummary)
    }
  }, [
    socket,
    settings,
    mutes,
    viewedChannelId,
    viewedSessionId,
    queryClient,
    navigate,
    navigateToMessage,
  ])
}
