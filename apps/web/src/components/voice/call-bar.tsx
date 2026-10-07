import { Button } from "@repo/ui/components/button"
import { toast } from "@repo/ui/components/toast"
import { useVoiceCall } from "@/context/voice-call-context"

// "In a call on another device", with Transfer here. A call on this device
// shows the floating call window instead (call-window.tsx).
export function CallBar() {
  const { call, remoteCall, joining, join } = useVoiceCall()
  if (call || !remoteCall) return null

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
