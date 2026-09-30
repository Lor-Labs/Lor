import {
  CallEnd01Icon,
  Mic01Icon,
  MicOff01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTrackToggle } from "@livekit/components-react"
import { Button } from "@repo/ui/components/button"
import { toast } from "@repo/ui/components/toast"
import { Link } from "@tanstack/react-router"
import { Track } from "livekit-client"
import { useEffect, useRef } from "react"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import { useVoiceCall } from "@/context/voice-call-context"

export function CallBar() {
  const { call, remoteCall, joining, join, leave } = useVoiceCall()
  const microphone = useTrackToggle({ source: Track.Source.Microphone })

  // Leaving a live call ends access to its chat, so an open chat closes.
  const { view, clearView } = useRightSidebar()
  const openThreadRootId = view?.type === "thread" ? view.threadRootId : null
  const callChatRef = useRef<string | null>(null)
  useEffect(() => {
    const previous = callChatRef.current
    callChatRef.current = call?.threadRootId ?? null
    if (
      previous &&
      previous !== callChatRef.current &&
      openThreadRootId === previous
    ) {
      clearView()
    }
  }, [call?.threadRootId, openThreadRootId, clearView])

  if (call) {
    return (
      <div className="flex items-center gap-1 rounded-md border border-border bg-sidebar-accent/40 px-2 py-1.5">
        <Link
          to="/$workspaceSlug/$channelId"
          params={{
            workspaceSlug: call.workspaceSlug,
            channelId: call.channelId,
          }}
          className="min-w-0 flex-1"
        >
          <div className="text-xs font-medium text-success">
            Voice connected
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {call.channelName}
          </div>
        </Link>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label={microphone.enabled ? "Mute" : "Unmute"}
          disabled={microphone.pending}
          onClick={() => void microphone.toggle()}
        >
          <HugeiconsIcon
            icon={microphone.enabled ? Mic01Icon : MicOff01Icon}
            strokeWidth={2}
          />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label="Leave call"
          onClick={() => void leave()}
        >
          <HugeiconsIcon icon={CallEnd01Icon} strokeWidth={2} />
        </Button>
      </div>
    )
  }

  if (!remoteCall) return null

  const transfer = () =>
    join({
      workspaceSlug: remoteCall.workspaceSlug,
      channelId: remoteCall.channelId,
      channelName: remoteCall.channelName ?? "Voice",
    }).catch((error: unknown) => {
      toast.error(
        error instanceof Error ? error.message : "Could not join the call"
      )
    })

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-sidebar-accent/40 px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium">In a call on another device</div>
        <div className="truncate text-xs text-muted-foreground">
          {remoteCall.channelName ?? "Voice"}
        </div>
      </div>
      <Button
        size="xs"
        variant="outline"
        disabled={joining}
        onClick={() => void transfer()}
      >
        Transfer here
      </Button>
    </div>
  )
}
