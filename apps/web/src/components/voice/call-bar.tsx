import {
  CallEnd01Icon,
  Mic01Icon,
  MicOff01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTrackToggle } from "@livekit/components-react"
import { Button } from "@repo/ui/components/button"
import { Link } from "@tanstack/react-router"
import { Track } from "livekit-client"
import { useVoiceCall } from "@/context/voice-call-context"

export function CallBar() {
  const { call, leave } = useVoiceCall()
  const microphone = useTrackToggle({ source: Track.Source.Microphone })
  if (!call) return null

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
        <div className="text-xs font-medium text-success">Voice connected</div>
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
