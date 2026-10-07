import {
  CallEnd01Icon,
  ClosedCaptionIcon,
  ComputerScreenShareIcon,
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
import {
  Tooltip,
  TooltipContent,
  TooltipCreateHandle,
  type TooltipPrimitive,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { ConnectionState, Track } from "livekit-client"
import { type ReactNode, useState } from "react"
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
    useMediaDeviceSelect({ kind, onError: reportDeviceError })
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

type TooltipHandle = TooltipPrimitive.Handle<string>

// One tooltip moves along the row (grouped, like the message action bar's);
// this bridges the gap to the next button so it stays open across it.
const TOOLTIP_BRIDGE =
  "pointer-fine:after:absolute pointer-fine:after:left-full pointer-fine:after:h-full pointer-fine:after:w-2"

function ControlButton({
  tooltip,
  label,
  variant,
  pressed,
  disabled,
  bridge = true,
  onClick,
  children,
}: {
  tooltip: TooltipHandle
  label: string
  variant: "secondary" | "outline" | "destructive"
  pressed?: boolean
  disabled?: boolean
  // Off for the last button in the row.
  bridge?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <TooltipTrigger
      handle={tooltip}
      payload={label}
      delay={300}
      render={
        <Button
          size="icon"
          variant={variant}
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={onClick}
          className={bridge ? TOOLTIP_BRIDGE : undefined}
        />
      }
    >
      {children}
    </TooltipTrigger>
  )
}

function DevicesMenu({ tooltip }: { tooltip: TooltipHandle }) {
  const [open, setOpen] = useState(false)
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <TooltipTrigger
        handle={tooltip}
        payload="Devices"
        delay={300}
        disabled={open}
        render={
          <DropdownMenuTrigger
            render={
              <Button
                size="icon"
                variant="outline"
                aria-label="Devices"
                className={TOOLTIP_BRIDGE}
              />
            }
          />
        }
      >
        <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} />
      </TooltipTrigger>
      <DropdownMenuContent side="top">
        <DeviceGroup kind="audioinput" label="Microphone" />
        <DeviceGroup kind="videoinput" label="Camera" />
        <DeviceGroup kind="audiooutput" label="Speaker" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CallChatButton({ tooltip }: { tooltip: TooltipHandle }) {
  const { available, open, unread, toggle } = useCallChatPanel()
  if (!available) return null

  return (
    <div className="relative">
      <ControlButton
        tooltip={tooltip}
        label={open ? "Hide chat" : "Show chat"}
        variant={open ? "secondary" : "outline"}
        onClick={toggle}
      >
        <HugeiconsIcon icon={Message01Icon} strokeWidth={2} />
      </ControlButton>
      {!open && <CallChatUnreadBadge count={unread} />}
    </div>
  )
}

export function CallControls() {
  const { leave, captionsOn, toggleCaptions } = useVoiceCall()
  const [tooltip] = useState(() => TooltipCreateHandle<string>())
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
        <ControlButton
          tooltip={tooltip}
          label={microphone.enabled ? "Mute" : "Unmute"}
          variant={microphone.enabled ? "secondary" : "outline"}
          disabled={microphone.pending}
          onClick={() => void microphone.toggle()}
        >
          <HugeiconsIcon
            icon={microphone.enabled ? Mic01Icon : MicOff01Icon}
            strokeWidth={2}
          />
        </ControlButton>
        <ControlButton
          tooltip={tooltip}
          label={camera.enabled ? "Turn camera off" : "Turn camera on"}
          variant={camera.enabled ? "secondary" : "outline"}
          disabled={camera.pending}
          onClick={() => void camera.toggle()}
        >
          <HugeiconsIcon
            icon={camera.enabled ? Video01Icon : VideoOffIcon}
            strokeWidth={2}
          />
        </ControlButton>
        <ControlButton
          tooltip={tooltip}
          label={
            canShareScreen
              ? screenShare.enabled
                ? "Stop sharing"
                : "Share screen"
              : "Screen sharing isn't available here"
          }
          variant={screenShare.enabled ? "secondary" : "outline"}
          disabled={!canShareScreen || screenShare.pending}
          onClick={() => void screenShare.toggle()}
        >
          <HugeiconsIcon icon={ComputerScreenShareIcon} strokeWidth={2} />
        </ControlButton>
        <DevicesMenu tooltip={tooltip} />
        {/* No crossed-out CC icon, so on and off read like the chat toggle. */}
        <ControlButton
          tooltip={tooltip}
          label={captionsOn ? "Hide captions" : "Show captions"}
          variant={captionsOn ? "secondary" : "outline"}
          pressed={captionsOn}
          onClick={toggleCaptions}
        >
          <HugeiconsIcon icon={ClosedCaptionIcon} strokeWidth={2} />
        </ControlButton>
        <CallChatButton tooltip={tooltip} />
        {import.meta.env.DEV && (
          <LorSimulatorMenu
            tooltipHandle={tooltip}
            className={TOOLTIP_BRIDGE}
          />
        )}
        <ControlButton
          tooltip={tooltip}
          label="Leave call"
          variant="destructive"
          bridge={false}
          onClick={() => void leave()}
        >
          <HugeiconsIcon icon={CallEnd01Icon} strokeWidth={2} />
        </ControlButton>
      </div>
      <Tooltip handle={tooltip}>
        {({ payload }) => <TooltipContent side="top">{payload}</TooltipContent>}
      </Tooltip>
    </div>
  )
}
