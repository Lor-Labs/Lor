import {
  ArrowDown01Icon,
  Mic01Icon,
  MicOff01Icon,
  Video01Icon,
  VideoOffIcon,
  VolumeHighIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { useMediaDeviceSelect } from "@livekit/components-react"
import { whoIsHere } from "@repo/realtime-types/voice-presence"
import { AvatarGroup, AvatarGroupCount } from "@repo/ui/components/avatar"
import { Button } from "@repo/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
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
import { differenceInMinutes, formatDuration } from "@repo/utils/date"
import { useParams } from "@tanstack/react-router"
import { createLocalVideoTrack } from "livekit-client"
import { useEffect, useRef, useState } from "react"
import {
  activeDevice,
  DeviceRadioGroup,
  reportDeviceError,
} from "@/components/voice/call-controls"
import { ParticipantAvatar } from "@/components/voice/participant-avatar"
import type { JoinDevices } from "@/context/voice-call-context"
import {
  hasDeviceNames,
  refreshLocalDevices,
  requestDeviceAccess,
  useLocalDevices,
} from "@/hooks/use-local-devices"
import { useOwnVoiceParticipant } from "@/hooks/use-own-voice-participant"
import type { VoiceSessionSummary } from "@/hooks/use-voice-sessions"

const STACK_LIMIT = 4

// Turns the microphone or camera on or off for the call; red while off.
function DeviceToggle({
  on,
  label,
  onIcon,
  offIcon,
  disabled,
  tooltipHandle,
  onToggle,
}: {
  on: boolean
  label: string
  onIcon: IconSvgElement
  offIcon: IconSvgElement
  disabled: boolean
  tooltipHandle: TooltipPrimitive.Handle<string>
  onToggle: () => void
}) {
  return (
    <TooltipTrigger
      handle={tooltipHandle}
      payload={`${label} ${on ? "on" : "off"}`}
      delay={300}
      render={
        <Button
          variant={on ? "outline" : "destructive-outline"}
          size="icon-lg"
          aria-label={label}
          aria-pressed={on}
          disabled={disabled}
          onClick={onToggle}
          className="pointer-fine:after:absolute pointer-fine:after:left-full pointer-fine:after:h-full pointer-fine:after:w-2"
        />
      }
    >
      <HugeiconsIcon icon={on ? onIcon : offIcon} strokeWidth={2} />
    </TooltipTrigger>
  )
}

// Only where the browser can route audio to a chosen output (Safari can't).
const canPickSpeaker =
  typeof HTMLMediaElement !== "undefined" &&
  "setSinkId" in HTMLMediaElement.prototype

function reportAccessError(kind: MediaDeviceKind, error: unknown) {
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

// Which microphone, speaker, or camera, by name, like Meet's row under the
// preview. Until the page has access the browser hides names, so the first
// click asks, then opens the list. Disabled only while the first listing
// loads or the browser's prompt is up, so a click is never lost.
function DevicePicker({
  kind,
  label,
  icon,
  devices,
  disabled,
}: {
  kind: MediaDeviceKind
  label: string
  icon: IconSvgElement
  devices: MediaDeviceInfo[] | null
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [asking, setAsking] = useState(false)
  const { activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({
    kind,
    requestPermissions: false,
    onError: reportDeviceError,
  })
  const ofKind = devices?.filter((device) => device.kind === kind) ?? []
  const named = hasDeviceNames(ofKind)
  const shown = named
    ? activeDevice(ofKind, activeDeviceId)?.label
    : `Default ${label.toLowerCase()}`

  function handleOpenChange(next: boolean) {
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

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || devices === null || asking}
            className="min-w-0 flex-1 text-muted-foreground hover:text-foreground"
          />
        }
      >
        <HugeiconsIcon icon={icon} strokeWidth={2} />
        <span className="sr-only">{label}: </span>
        <span className="min-w-0 truncate">{shown}</span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          strokeWidth={2}
          className="size-3.5"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start">
        <DeviceRadioGroup
          label={label}
          devices={ofKind}
          activeDeviceId={activeDeviceId}
          onSelect={(deviceId) => void setActiveMediaDevice(deviceId)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Your camera, before you join. Started only when you turn the camera on, so
// opening a voice channel never asks for camera access; stopped when it's
// turned off or you join. Follows the camera picked in the menu.
function CameraPreview({
  deviceId,
  onFail,
}: {
  deviceId: string
  onFail: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const failRef = useRef(onFail)
  failRef.current = onFail
  useEffect(() => {
    let cancelled = false
    let stop: (() => void) | undefined
    createLocalVideoTrack(deviceId === "default" ? undefined : { deviceId })
      .then((track) => {
        if (cancelled) {
          track.stop()
          return
        }
        stop = () => track.stop()
        if (videoRef.current) track.attach(videoRef.current)
        // A live camera reveals camera names to the pickers.
        void refreshLocalDevices()
      })
      .catch(() => failRef.current())
    return () => {
      cancelled = true
      stop?.()
    }
  }, [deviceId])
  return (
    <video
      ref={videoRef}
      muted
      playsInline
      className="absolute inset-0 size-full -scale-x-100 object-cover"
    />
  )
}

// A voice channel before you join, like Google Meet's: how you'll appear
// (your camera, or your avatar with it off) with the microphone and camera
// choices on it, beside who's in the call and Join.
export function CallHero({
  channelName,
  session,
  joinLabel,
  joinDisabled,
  note,
  onJoin,
}: {
  channelName: string
  session: VoiceSessionSummary | undefined
  // Replaces "Join call" / "Start call" while joining, transferring, or
  // switching calls.
  joinLabel: string | undefined
  joinDisabled: boolean
  note: string | undefined
  onJoin: (devices: JoinDevices) => void
}) {
  const { workspaceSlug } = useParams({ strict: false })
  const me = useOwnVoiceParticipant(workspaceSlug)
  const [microphone, setMicrophone] = useState(true)
  const [camera, setCamera] = useState(false)
  const [tooltipHandle] = useState(() => TooltipCreateHandle<string>())
  // The preview lets go of the camera before the call takes it.
  const [previewing, setPreviewing] = useState(true)
  // The camera picked in the row (on the call's room), for the preview.
  // LiveKit asks for access by default; a visit must not.
  const { activeDeviceId: cameraId } = useMediaDeviceSelect({
    kind: "videoinput",
    requestPermissions: false,
  })
  const devices = useLocalDevices()
  const connected = session?.participants.filter((p) => p.connected) ?? []
  const live = session !== undefined && connected.length > 0
  // Re-read the clock so "Live for 3 min" keeps counting while you look.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!live) return
    setNow(new Date())
    const timer = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(timer)
  }, [live])
  const shown = connected.slice(0, STACK_LIMIT)
  const extra = connected.length - shown.length

  // Sized by the lobby column, not the window: with the call panel open the
  // column narrows, so everything stacks under the preview. Side by side, the
  // Join column centers on the preview alone, as in Meet, not on the preview
  // plus the device row.
  return (
    <section className="@container">
      <div className="grid items-center gap-y-2 @2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @2xl:gap-x-8">
        <div className="relative aspect-video overflow-hidden rounded-2xl border border-border bg-card shadow-xs/5 @2xl:col-start-1 @2xl:row-start-1">
          {camera && previewing ? (
            <CameraPreview
              deviceId={cameraId}
              onFail={() => {
                setCamera(false)
                toast.error("Camera unavailable")
              }}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pb-10">
              {me && <ParticipantAvatar participant={me} size="xl" />}
              <span className="text-muted-foreground text-sm">
                Camera is off
              </span>
            </div>
          )}
          {me && (
            <span className="absolute top-3 left-3 max-w-[calc(100%-1.5rem)] truncate rounded-md bg-background/80 px-1.5 py-0.5 text-xs font-medium">
              {me.name}
            </span>
          )}
          {/* A soft scrim keeps the controls readable over a camera. */}
          <div className="absolute inset-x-0 bottom-0 flex justify-center gap-2 bg-linear-to-t from-background/70 to-transparent px-3 pt-8 pb-3">
            <DeviceToggle
              on={microphone}
              label="Microphone"
              onIcon={Mic01Icon}
              offIcon={MicOff01Icon}
              disabled={joinDisabled}
              tooltipHandle={tooltipHandle}
              onToggle={() => setMicrophone((on) => !on)}
            />
            <DeviceToggle
              on={camera}
              label="Camera"
              onIcon={Video01Icon}
              offIcon={VideoOffIcon}
              disabled={joinDisabled}
              tooltipHandle={tooltipHandle}
              onToggle={() => setCamera((on) => !on)}
            />
            <Tooltip handle={tooltipHandle}>
              {({ payload }) => (
                <TooltipContent side="top">{payload}</TooltipContent>
              )}
            </Tooltip>
          </div>
        </div>
        <div className="flex gap-1 @2xl:col-start-1 @2xl:row-start-2">
          <DevicePicker
            kind="audioinput"
            label="Microphone"
            icon={Mic01Icon}
            devices={devices}
            disabled={joinDisabled}
          />
          {canPickSpeaker && (
            <DevicePicker
              kind="audiooutput"
              label="Speaker"
              icon={VolumeHighIcon}
              devices={devices}
              disabled={joinDisabled}
            />
          )}
          <DevicePicker
            kind="videoinput"
            label="Camera"
            icon={Video01Icon}
            devices={devices}
            disabled={joinDisabled}
          />
        </div>

        <div className="mt-4 flex flex-col items-center gap-4 text-center @2xl:col-start-2 @2xl:row-start-1 @2xl:mt-0">
          <div className="flex flex-col items-center gap-2">
            {live && (
              <AvatarGroup>
                {shown.map((participant) => (
                  <ParticipantAvatar
                    key={participant.userId}
                    participant={participant}
                  />
                ))}
                {extra > 0 && (
                  <AvatarGroupCount className="size-6 text-xs">
                    +{extra}
                  </AvatarGroupCount>
                )}
              </AvatarGroup>
            )}
            <h2 className="text-balance font-semibold text-lg leading-snug">
              {live
                ? whoIsHere(connected.map((participant) => participant.name))
                : `It's quiet in ${channelName}`}
            </h2>
            {live ? (
              <p className="flex items-center gap-2 text-muted-foreground text-sm">
                <span className="size-2 shrink-0 rounded-full bg-success" />
                Live for{" "}
                {formatDuration(differenceInMinutes(session.startedAt, now))}
              </p>
            ) : (
              <p className="text-muted-foreground text-sm">
                Start a call and others can drop in.
              </p>
            )}
          </div>
          <Button
            size="lg"
            className="w-full max-w-56"
            disabled={joinDisabled}
            onClick={() => {
              setPreviewing(false)
              onJoin({ microphone, camera })
            }}
          >
            {joinLabel ?? (live ? "Join call" : "Start call")}
          </Button>
          {note && <p className="text-muted-foreground text-xs">{note}</p>}
        </div>
      </div>
    </section>
  )
}
