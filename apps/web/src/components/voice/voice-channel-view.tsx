import { VolumeHighIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { toast } from "@repo/ui/components/toast"
import { useQuery } from "@tanstack/react-query"
import { HeaderNavControls } from "@/components/desktop-titlebar"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import { CallStage } from "@/components/voice/call-stage"
import { VoiceLobby } from "@/components/voice/voice-lobby"
import { useVoiceCall } from "@/context/voice-call-context"
import { useAutoMarkRead } from "@/hooks/use-auto-mark-read"
import { useDeleteCall } from "@/hooks/use-delete-call"
import { useThreadPanelUrlSync } from "@/hooks/use-thread-panel-url-sync"
import { apiClient } from "@/lib/api-client"
import { canDeleteVoiceCalls, canModerateVoice } from "@/lib/permissions"

// Phone browsers are out of scope; the iPhone app handles calls.
const isPhoneBrowser = /iPhone|iPod|Android.+Mobile/i.test(navigator.userAgent)

export function VoiceChannelView({
  workspaceSlug,
  workspaceId,
  channelId,
  channelName,
  archived,
  threadId,
  threadMessageId,
  callAt,
}: {
  workspaceSlug: string
  workspaceId: string | undefined
  channelId: string
  channelName: string
  archived: boolean
  threadId: string | undefined
  threadMessageId: string | undefined
  callAt: number | undefined
}) {
  const { call, remoteCall, joining, join } = useVoiceCall()
  const inThisCall = call?.channelId === channelId
  useAutoMarkRead(channelId)
  useThreadPanelUrlSync({
    workspaceSlug,
    channelId,
    threadId,
    threadMessageId,
    callAt,
    transientThreadRootId: inThisCall ? call.threadRootId : null,
  })
  const { view, setView, isCollapsed, toggleCollapsed } = useRightSidebar()
  const openThreadRootId =
    view?.type === "thread" && !isCollapsed ? view.threadRootId : null
  const openSession = (
    threadRootId: string,
    callTab: "chat" | "transcript"
  ) => {
    setView({ type: "thread", workspaceSlug, channelId, threadRootId, callTab })
    if (isCollapsed) toggleCollapsed()
  }

  // Same queries the sidebar runs; react-query dedupes them.
  const { data: activeMember } = useQuery({
    queryKey: ["active-workspace-member", workspaceSlug],
    queryFn: async (): Promise<{ userId: string; role: string } | null> => {
      const res = await authClient.organization.getActiveMember()
      return res.data
        ? {
            userId: res.data.userId as string,
            role: res.data.role as string,
          }
        : null
    },
  })
  const { data: workspaceMembersData } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].members.$get({
        param: { workspaceSlug },
      })
      if (!res.ok) throw new Error("Failed to fetch workspace members")
      return res.json()
    },
  })
  const canModerate =
    activeMember && workspaceMembersData?.ownerId
      ? canModerateVoice(activeMember, {
          ownerId: workspaceMembersData.ownerId,
        })
      : false
  const canDeleteCalls =
    activeMember && workspaceMembersData?.ownerId
      ? canDeleteVoiceCalls(activeMember, {
          ownerId: workspaceMembersData.ownerId,
        })
      : false
  const deleteCall = useDeleteCall(workspaceSlug, channelId)
  const onAnotherDevice = remoteCall?.channelId === channelId
  const otherCall = call ?? remoteCall
  const otherCallName =
    otherCall && otherCall.channelId !== channelId
      ? (otherCall.channelName ?? "another channel")
      : undefined
  const joinLabel = isPhoneBrowser
    ? "Open the Lor app to join"
    : joining
      ? "Joining…"
      : onAnotherDevice
        ? "Transfer here"
        : otherCallName
          ? "Switch to this call"
          : "Join"
  const note = onAnotherDevice
    ? "You're in this call on another device."
    : otherCallName
      ? `You're in a call in ${otherCallName}.`
      : undefined

  const handleJoin = async () => {
    try {
      await join({ workspaceSlug, channelId, channelName })
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not join the call"
      )
    }
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <HeaderNavControls className="-ml-2" withDivider />
        <HugeiconsIcon
          icon={VolumeHighIcon}
          className="size-5 shrink-0 text-muted-foreground"
          strokeWidth={2}
        />
        <span className="truncate font-semibold">{channelName}</span>
      </div>
      {inThisCall ? (
        <CallStage canModerate={canModerate} />
      ) : (
        <VoiceLobby
          channelId={channelId}
          workspaceId={workspaceId}
          joinLabel={joinLabel}
          joinDisabled={joining || archived || isPhoneBrowser}
          note={note}
          onJoin={() => void handleJoin()}
          openThreadRootId={openThreadRootId}
          onOpenSession={openSession}
          onDeleteSession={canDeleteCalls ? deleteCall : undefined}
        />
      )}
    </div>
  )
}
