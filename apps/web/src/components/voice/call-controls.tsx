import {
  ArrowUp01Icon,
  CallEnd01Icon,
  ClosedCaptionIcon,
  ComputerScreenShareIcon,
  Message01Icon,
  Mic01Icon,
  MicOff01Icon,
  Video01Icon,
  VideoOffIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import {
  useAudioPlayback,
  useConnectionState,
  useMediaDeviceSelect,
  useTrackToggle,
} from "@livekit/components-react"
import { Button } from "@repo/ui/components/button"
import { ButtonGroup, ButtonGroupSeparator } from "@repo/ui/components/group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
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
import { cn } from "@repo/ui/lib/utils"
import { ConnectionState, Track } from "livekit-client"
import { type ReactNode, useState } from "react"
import { CallChatUnreadBadge } from "@/components/voice/call-chat-unread-badge"
import { LorSimulatorMenu } from "@/components/voice/lor-simulator"
import { useVoiceCall } from "@/context/voice-call-context"
import { useCallChatPanel } from "@/hooks/use-call-chat-panel"
import {
  hasDeviceNames,
  requestDeviceAccess,
  useLocalDevices,
} from "@/hooks/use-local-devices"
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

// Only where the browser can route audio to a chosen output (Safari can't).
export const canPickSpeaker =
  typeof HTMLMediaElement !== "undefined" &&
  "setSinkId" in HTMLMediaElement.prototype

export function reportAccessError(kind: MediaDeviceKind, error: unknown) {
  const noun = kind === "videoinput" ? "Camera" : "Microphone"
  const name = error instanceof DOMException ? error.name : ""
  if (name === "NotAllowedError") {
    toast.error(`${noun} access is blocked`, {
      description: "Allow it in your browser's site settings.",
    })
  } else if (name === "NotFoundError") {
    toast.error(`No ${noun.toLowerCase()} found`)
  } else {
    reportDeviceError(error)
  }
}

// A device menu over the shared device list. Until the page has used that
// kind of device the browser hides names (and lists no speakers), so the
// first open asks for access, then opens: a list never shows nameless or
// empty. The pre-join pickers and the call controls both use it.
export function useDeviceMenu(
  kind: MediaDeviceKind,
  devices: MediaDeviceInfo[] | null
) {
  const [open, setOpen] = useState(false)
  const [asking, setAsking] = useState(false)
  const ofKind = devices?.filter((device) => device.kind === kind) ?? []
  const named = hasDeviceNames(ofKind)
  const onOpenChange = (next: boolean) => {
    if (!next || named) {
      setOpen(next)
      return
    }
    setAsking(true)
    requestDeviceAccess(kind)
      .then((list) =>
        setOpen(hasDeviceNames(list.filter((device) => device.kind === kind)))
      )
      .catch((error) => reportAccessError(kind, error))
      .finally(() => setAsking(false))
  }
  return { open, onOpenChange, asking, ofKind, named }
}

function DeviceKindGroup({
  kind,
  label,
  devices,
}: {
  kind: MediaDeviceKind
  label: string
  devices: MediaDeviceInfo[] | null
}) {
  const { activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({
    kind,
    requestPermissions: false,
    onError: reportDeviceError,
  })
  const ofKind = devices?.filter((device) => device.kind === kind) ?? []
  if (ofKind.length === 0) return null

  return (
    <DeviceRadioGroup
      label={label}
      devices={ofKind}
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
// Across a split button's 1px divider.
const DIVIDER_BRIDGE =
  "pointer-fine:after:absolute pointer-fine:after:left-full pointer-fine:after:h-full pointer-fine:after:w-px"
// A muted microphone, red like Discord's: both halves, with a dark divider.
const MUTED =
  "bg-destructive/12 text-destructive-foreground hover:bg-destructive/20 data-pressed:bg-destructive/20"
// A feature that's on (sharing, captions, chat open): tinted with the
// primary colour, so on and off can't be confused. Off is a plain outline.
const ACTIVE =
  "border-primary/40 bg-primary/15 text-primary hover:bg-primary/20 data-pressed:bg-primary/20"

function ControlButton({
  tooltip,
  label,
  active = false,
  destructive = false,
  pressed,
  disabled,
  bridge = true,
  onClick,
  children,
}: {
  tooltip: TooltipHandle
  label: string
  active?: boolean
  destructive?: boolean
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
          variant={destructive ? "destructive" : active ? "ghost" : "outline"}
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={onClick}
          className={cn(bridge && TOOLTIP_BRIDGE, active && ACTIVE)}
        />
      }
    >
      {children}
    </TooltipTrigger>
  )
}

// The microphone or camera as a split button: the left half turns it on or
// off, the chevron picks the device (the microphone's also the speaker).
// Both look normal (outlined) while on; the icon shows the state, and a
// muted microphone turns both halves red.
function DeviceSplitButton({
  tooltip,
  kind,
  label,
  menuLabel,
  on,
  alertWhenOff,
  pending,
  onIcon,
  offIcon,
  devices,
  onToggle,
  children,
}: {
  tooltip: TooltipHandle
  // Whose access the menu asks for while names are hidden.
  kind: MediaDeviceKind
  label: string
  menuLabel: string
  on: boolean
  alertWhenOff: boolean
  pending: boolean
  onIcon: IconSvgElement
  offIcon: IconSvgElement
  devices: MediaDeviceInfo[] | null
  onToggle: () => void
  // The menu's device lists.
  children: ReactNode
}) {
  const menu = useDeviceMenu(kind, devices)
  const alert = alertWhenOff && !on
  return (
    <ButtonGroup>
      <TooltipTrigger
        handle={tooltip}
        payload={label}
        delay={300}
        render={
          <Button
            size="icon"
            variant={alert ? "ghost" : "outline"}
            aria-label={label}
            disabled={pending}
            onClick={onToggle}
            className={cn(DIVIDER_BRIDGE, alert && MUTED)}
          />
        }
      >
        <HugeiconsIcon icon={on ? onIcon : offIcon} strokeWidth={2} />
      </TooltipTrigger>
      <ButtonGroupSeparator
        className={alert ? "bg-background before:hidden" : undefined}
      />
      <DropdownMenu open={menu.open} onOpenChange={menu.onOpenChange}>
        <TooltipTrigger
          handle={tooltip}
          payload={menuLabel}
          delay={300}
          disabled={menu.open}
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon"
                  variant={alert ? "ghost" : "outline"}
                  aria-label={menuLabel}
                  disabled={devices === null || menu.asking}
                  className={cn(TOOLTIP_BRIDGE, alert && MUTED)}
                />
              }
            />
          }
        >
          <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} />
        </TooltipTrigger>
        <DropdownMenuContent side="top" align="start">
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
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
        active={open}
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
  const devices = useLocalDevices()
  const speakers =
    canPickSpeaker &&
    Boolean(devices?.some((device) => device.kind === "audiooutput"))

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
        <DeviceSplitButton
          tooltip={tooltip}
          kind="audioinput"
          label={microphone.enabled ? "Mute" : "Unmute"}
          menuLabel="Audio devices"
          on={microphone.enabled}
          alertWhenOff
          pending={microphone.pending}
          onIcon={Mic01Icon}
          offIcon={MicOff01Icon}
          devices={devices}
          onToggle={() => void microphone.toggle()}
        >
          <DeviceKindGroup
            kind="audioinput"
            label="Microphone"
            devices={devices}
          />
          {speakers && (
            <>
              <DropdownMenuSeparator />
              <DeviceKindGroup
                kind="audiooutput"
                label="Speaker"
                devices={devices}
              />
            </>
          )}
        </DeviceSplitButton>
        <DeviceSplitButton
          tooltip={tooltip}
          kind="videoinput"
          label={camera.enabled ? "Turn camera off" : "Turn camera on"}
          menuLabel="Choose camera"
          on={camera.enabled}
          alertWhenOff={false}
          pending={camera.pending}
          onIcon={Video01Icon}
          offIcon={VideoOffIcon}
          devices={devices}
          onToggle={() => void camera.toggle()}
        >
          <DeviceKindGroup kind="videoinput" label="Camera" devices={devices} />
        </DeviceSplitButton>
        <ControlButton
          tooltip={tooltip}
          label={
            canShareScreen
              ? screenShare.enabled
                ? "Stop sharing"
                : "Share screen"
              : "Screen sharing isn't available here"
          }
          active={screenShare.enabled}
          disabled={!canShareScreen || screenShare.pending}
          onClick={() => void screenShare.toggle()}
        >
          <HugeiconsIcon icon={ComputerScreenShareIcon} strokeWidth={2} />
        </ControlButton>
        {/* No crossed-out CC icon, so on and off read like the chat toggle. */}
        <ControlButton
          tooltip={tooltip}
          label={captionsOn ? "Hide captions" : "Show captions"}
          active={captionsOn}
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
          destructive
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
