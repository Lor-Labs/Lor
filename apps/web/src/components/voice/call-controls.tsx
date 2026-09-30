import {
  CallEnd01Icon,
  ComputerScreenShareIcon,
  HeadphoneMuteIcon,
  HeadphonesIcon,
  Message01Icon,
  Mic01Icon,
  MicOff01Icon,
  Settings02Icon,
  Video01Icon,
  VideoOffIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  useAudioPlayback,
  useConnectionState,
  useMediaDeviceSelect,
  useTrackToggle,
} from "@livekit/components-react"
import { Button } from "@repo/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/menu"
import { toast } from "@repo/ui/components/toast"
import { ConnectionState, Track } from "livekit-client"
import { CallChatUnreadBadge } from "@/components/voice/call-chat-unread-badge"
import { useVoiceCall } from "@/context/voice-call-context"
import { useCallChatPanel } from "@/hooks/use-call-chat-panel"

const canShareScreen =
  typeof navigator.mediaDevices?.getDisplayMedia === "function"

function reportDeviceError(error: Error) {
  toast.error(error.message || "Could not access the device")
}

function DeviceGroup({
  kind,
  label,
}: {
  kind: MediaDeviceKind
  label: string
}) {
  const { devices, activeDeviceId, setActiveMediaDevice } =
    useMediaDeviceSelect({ kind, onError: reportDeviceError })
  if (devices.length === 0) return null

  return (
    <>
      <DropdownMenuLabel>{label}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={activeDeviceId}
        onValueChange={(value) => {
          if (typeof value === "string") void setActiveMediaDevice(value)
        }}
      >
        {devices.map((device) => (
          <DropdownMenuRadioItem key={device.deviceId} value={device.deviceId}>
            {device.label || "Unnamed device"}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  )
}

function CallChatButton() {
  const { available, open, unread, toggle } = useCallChatPanel()
  if (!available) return null

  return (
    <div className="relative">
      <Button
        size="icon"
        variant={open ? "secondary" : "outline"}
        aria-label={open ? "Hide chat" : "Show chat"}
        onClick={toggle}
      >
        <HugeiconsIcon icon={Message01Icon} strokeWidth={2} />
      </Button>
      {!open && <CallChatUnreadBadge count={unread} />}
    </div>
  )
}

export function CallControls() {
  const { leave, deafened, toggleDeafen } = useVoiceCall()
  const microphone = useTrackToggle({
    source: Track.Source.Microphone,
    onDeviceError: reportDeviceError,
  })
  // Unmuting while deafened undeafens too, so the person can be heard back.
  const toggleMicrophone = async () => {
    if (deafened) {
      await toggleDeafen()
      await microphone.toggle(true)
      return
    }
    await microphone.toggle()
  }
  const camera = useTrackToggle({
    source: Track.Source.Camera,
    onDeviceError: reportDeviceError,
  })
  const screenShare = useTrackToggle({
    source: Track.Source.ScreenShare,
    onDeviceError: reportDeviceError,
  })
  const { canPlayAudio, startAudio } = useAudioPlayback()
  const connectionState = useConnectionState()

  return (
    <div className="flex shrink-0 flex-col items-center gap-2">
      {connectionState === ConnectionState.Reconnecting && (
        <span className="text-xs text-muted-foreground">Reconnecting…</span>
      )}
      {!canPlayAudio && (
        <Button size="sm" variant="outline" onClick={() => void startAudio()}>
          Start audio
        </Button>
      )}
      <div className="flex items-center gap-2">
        <Button
          size="icon"
          variant={microphone.enabled ? "secondary" : "outline"}
          aria-label={microphone.enabled ? "Mute" : "Unmute"}
          disabled={microphone.pending}
          onClick={() => void toggleMicrophone()}
        >
          <HugeiconsIcon
            icon={microphone.enabled ? Mic01Icon : MicOff01Icon}
            strokeWidth={2}
          />
        </Button>
        <Button
          size="icon"
          variant={deafened ? "outline" : "secondary"}
          aria-label={deafened ? "Undeafen" : "Deafen"}
          onClick={() => void toggleDeafen()}
        >
          <HugeiconsIcon
            icon={deafened ? HeadphoneMuteIcon : HeadphonesIcon}
            strokeWidth={2}
          />
        </Button>
        <Button
          size="icon"
          variant={camera.enabled ? "secondary" : "outline"}
          aria-label={camera.enabled ? "Turn camera off" : "Turn camera on"}
          disabled={camera.pending}
          onClick={() => void camera.toggle()}
        >
          <HugeiconsIcon
            icon={camera.enabled ? Video01Icon : VideoOffIcon}
            strokeWidth={2}
          />
        </Button>
        <Button
          size="icon"
          variant={screenShare.enabled ? "secondary" : "outline"}
          aria-label={
            canShareScreen
              ? screenShare.enabled
                ? "Stop sharing"
                : "Share screen"
              : "Screen sharing isn't available here"
          }
          disabled={!canShareScreen || screenShare.pending}
          onClick={() => void screenShare.toggle()}
        >
          <HugeiconsIcon icon={ComputerScreenShareIcon} strokeWidth={2} />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button size="icon" variant="outline" aria-label="Devices" />
            }
          >
            <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top">
            <DeviceGroup kind="audioinput" label="Microphone" />
            <DeviceGroup kind="videoinput" label="Camera" />
            <DeviceGroup kind="audiooutput" label="Speaker" />
          </DropdownMenuContent>
        </DropdownMenu>
        <CallChatButton />
        <Button
          size="icon"
          variant="destructive"
          aria-label="Leave call"
          onClick={() => void leave()}
        >
          <HugeiconsIcon icon={CallEnd01Icon} strokeWidth={2} />
        </Button>
      </div>
    </div>
  )
}
