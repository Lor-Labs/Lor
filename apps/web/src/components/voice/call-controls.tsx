import {
  CallEnd01Icon,
  CaptionsIcon,
  CaptionsOffIcon,
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
import { LorSimulatorMenu } from "@/components/voice/lor-simulator"
import { useVoiceCall } from "@/context/voice-call-context"
import { useCallChatPanel } from "@/hooks/use-call-chat-panel"
import { useMicrophoneToggle } from "@/hooks/use-microphone-toggle"

const canShareScreen =
  typeof navigator.mediaDevices?.getDisplayMedia === "function"

export function reportDeviceError(error: unknown) {
  toast.error(
    error instanceof Error && error.message
      ? error.message
      : "Could not access the device"
  )
}

// LiveKit reports "default" until a track is published. Only Chrome lists a
// "default" entry; elsewhere show the first device, which browsers list first.
export function activeDevice(
  devices: MediaDeviceInfo[],
  activeDeviceId: string
) {
  return (
    devices.find((device) => device.deviceId === activeDeviceId) ?? devices[0]
  )
}

// A device list for a menu. Picking one switches the call's room, so a choice
// made before joining carries into the call.
export function DeviceRadioGroup({
  label,
  devices,
  activeDeviceId,
  onSelect,
}: {
  label: string
  devices: MediaDeviceInfo[]
  activeDeviceId: string
  onSelect: (deviceId: string) => void
}) {
  return (
    <DropdownMenuRadioGroup
      value={activeDevice(devices, activeDeviceId)?.deviceId}
      onValueChange={(value) => {
        if (typeof value === "string") onSelect(value)
      }}
    >
      <DropdownMenuLabel>{label}</DropdownMenuLabel>
      {devices.map((device) => (
        <DropdownMenuRadioItem key={device.deviceId} value={device.deviceId}>
          {device.label || "Unnamed device"}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}

function DeviceGroup({
  kind,
  label,
}: {
  kind: MediaDeviceKind
  label: string
}) {
  const { devices, activeDeviceId, setActiveMediaDevice } =
    useMediaDeviceSelect({
      kind,
      requestPermissions: false,
      onError: reportDeviceError,
    })
  if (devices.length === 0) return null

  return (
    <DeviceRadioGroup
      label={label}
      devices={devices}
      activeDeviceId={activeDeviceId}
      onSelect={(deviceId) => void setActiveMediaDevice(deviceId)}
    />
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
  const { leave, deafened, toggleDeafen, captionsOn, toggleCaptions } =
    useVoiceCall()
  const microphone = useMicrophoneToggle(reportDeviceError)
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
          onClick={() => void microphone.toggle()}
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
        <Button
          size="icon"
          variant={captionsOn ? "secondary" : "outline"}
          aria-label={captionsOn ? "Hide captions" : "Show captions"}
          onClick={toggleCaptions}
        >
          <HugeiconsIcon
            icon={captionsOn ? CaptionsIcon : CaptionsOffIcon}
            strokeWidth={2}
          />
        </Button>
        <CallChatButton />
        {import.meta.env.DEV && <LorSimulatorMenu />}
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
