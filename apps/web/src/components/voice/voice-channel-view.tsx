import { VolumeHighIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { toast } from "@repo/ui/components/toast"
import { HeaderNavControls } from "@/components/desktop-titlebar"
import { CallStage } from "@/components/voice/call-stage"
import { VoiceLobby } from "@/components/voice/voice-lobby"
import { useVoiceCall } from "@/context/voice-call-context"

export function VoiceChannelView({
  workspaceSlug,
  workspaceId,
  channelId,
  channelName,
  archived,
}: {
  workspaceSlug: string
  workspaceId: string | undefined
  channelId: string
  channelName: string
  archived: boolean
}) {
  const { call, joining, join } = useVoiceCall()
  const inThisCall = call?.channelId === channelId

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
        <CallStage />
      ) : (
        <VoiceLobby
          channelId={channelId}
          workspaceId={workspaceId}
          otherCallName={call?.channelName}
          joining={joining}
          archived={archived}
          onJoin={() => void handleJoin()}
        />
      )}
    </div>
  )
}
