import {
  CallEnd01Icon,
  Message01Icon,
  Mic01Icon,
  MicOff01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  isTrackReference,
  type TrackReference,
  type TrackReferenceOrPlaceholder,
  useIsSpeaking,
  useLocalParticipant,
  useSpeakingParticipants,
  useTracks,
  VideoTrack,
} from "@livekit/components-react"
import { Button } from "@repo/ui/components/button"
import { cn } from "@repo/ui/lib/utils"
import { useNavigate, useParams } from "@tanstack/react-router"
import { Track } from "livekit-client"
import {
  AnimatePresence,
  animate,
  motion,
  useDragControls,
  useMotionValue,
} from "motion/react"
import { useEffect, useRef, useState } from "react"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import { UserAvatar } from "@/components/ui/user-avatar"
import { CallChatUnreadBadge } from "@/components/voice/call-chat-unread-badge"
import { reportDeviceError } from "@/components/voice/call-controls"
import {
  type ActiveVoiceCall,
  useVoiceCall,
} from "@/context/voice-call-context"
import { useCallChatPanel } from "@/hooks/use-call-chat-panel"
import { useMicrophoneToggle } from "@/hooks/use-microphone-toggle"

// A person gets a 4:3 window; a screen share (usually landscape) a wide 16:9
// one. Same rules as the phone's call tile.
const PERSON = { width: 224, height: 168 }
const SHARE = { width: 320, height: 180 }
type Size = typeof PERSON
const EDGE = 16
// Clears channel headers at the top and the composer at the bottom.
const TOP_CLEARANCE = 64
const BOTTOM_CLEARANCE = 96
// How far a flick carries the window before it picks a corner.
const FLICK_SECONDS = 0.15
// Critically damped: the window glides into its corner and stops, never
// passing it.
const SNAP = { type: "spring", duration: 0.3, bounce: 0 } as const
// Size and position move on one curve (ease-out cubic), so the edges against
// the corner stay put while it reshapes.
const RESHAPE = { duration: 0.22, ease: [0.33, 1, 0.68, 1] } as const

type Corner = { right: boolean; bottom: boolean }
const CORNER_KEY = "lor-call-window-corner"

function readCorner(): Corner {
  try {
    const [side, edge] = (localStorage.getItem(CORNER_KEY) ?? "").split(":")
    if (side && edge)
      return { right: side === "right", bottom: edge === "bottom" }
  } catch {}
  return { right: true, bottom: true }
}

function saveCorner(corner: Corner) {
  try {
    localStorage.setItem(
      CORNER_KEY,
      `${corner.right ? "right" : "left"}:${corner.bottom ? "bottom" : "top"}`
    )
  } catch {}
}

function cornerPosition(corner: Corner, size: Size, viewport: Size) {
  return {
    x: corner.right ? viewport.width - EDGE - size.width : EDGE,
    y: corner.bottom
      ? viewport.height - BOTTOM_CLEARANCE - size.height
      : TOP_CLEARANCE,
  }
}

// Keeps a flick's speed only when it heads toward the corner, so the window
// never drifts away before it comes back.
function speedToward(from: number, to: number, velocity: number) {
  return Math.sign(to - from) === Math.sign(velocity) ? velocity : 0
}

function useViewport() {
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))
  useEffect(() => {
    const onResize = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  return viewport
}

// Whoever spoke last, so the window follows the conversation; yourself when
// you're the only one here.
function useFeaturedTrack() {
  const tracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: true },
  ])
  const speaking = useSpeakingParticipants()
  const lastSpeaker = useRef<string | null>(null)
  const people = tracks.filter((track) => !track.participant.isAgent)
  const others = people.filter((track) => !track.participant.isLocal)
  const speaker = speaking.find(
    (participant) => !participant.isLocal && !participant.isAgent
  )
  if (speaker) lastSpeaker.current = speaker.identity
  const featured =
    others.find(
      (track) => track.participant.identity === lastSpeaker.current
    ) ??
    others[0] ??
    people[0]
  return { featured, alone: others.length === 0 }
}

function Label({ children }: { children: string }) {
  return (
    <span className="absolute top-2 left-2 max-w-[calc(100%-3rem)] truncate rounded-md bg-background/80 px-1.5 py-0.5 text-xs font-medium">
      {children}
    </span>
  )
}

function FeaturedParticipant({
  trackRef,
  alone,
}: {
  trackRef: TrackReferenceOrPlaceholder
  alone: boolean
}) {
  const { participant } = trackRef
  const speaking = useIsSpeaking(participant)
  const showVideo = isTrackReference(trackRef) && !trackRef.publication.isMuted
  const name = participant.name || participant.identity
  return (
    <>
      {showVideo ? (
        <VideoTrack
          trackRef={trackRef}
          className={cn(
            "size-full object-cover",
            participant.isLocal && "-scale-x-100"
          )}
        />
      ) : (
        <div className="flex size-full items-center justify-center">
          <UserAvatar name={name} className="size-14" />
        </div>
      )}
      <Label>{alone ? "Only you" : name}</Label>
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 rounded-xl ring-2 ring-transparent ring-inset transition-shadow duration-300",
          speaking && "ring-primary duration-100"
        )}
      />
    </>
  )
}

// While someone shares their screen the window shows the share, as Slack's,
// Meet's, and Zoom's do.
function SharePreview({ trackRef }: { trackRef: TrackReference }) {
  const name = trackRef.participant.name || trackRef.participant.identity
  return (
    <>
      <VideoTrack trackRef={trackRef} className="size-full object-contain" />
      <Label>{`${name}'s screen`}</Label>
    </>
  )
}

// Re-renders on every speaker change, so it's kept apart from the drag.
function WindowContent({ share }: { share: TrackReference | undefined }) {
  const { featured, alone } = useFeaturedTrack()
  if (share) return <SharePreview trackRef={share} />
  return featured ? (
    <FeaturedParticipant trackRef={featured} alone={alone} />
  ) : null
}

function WindowControls({ onLeave }: { onLeave: () => void }) {
  const microphone = useMicrophoneToggle(reportDeviceError)
  const chat = useCallChatPanel()
  return (
    <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1.5 bg-linear-to-t from-background/70 to-transparent px-2 pt-6 pb-2 opacity-0 transition-opacity duration-150 group-hover/call-window:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
      <Button
        size="icon-sm"
        variant="outline"
        aria-label={microphone.enabled ? "Mute" : "Unmute"}
        disabled={microphone.pending}
        onClick={() => void microphone.toggle()}
      >
        <HugeiconsIcon
          icon={microphone.enabled ? Mic01Icon : MicOff01Icon}
          strokeWidth={2}
        />
      </Button>
      {chat.available && (
        <div className="relative">
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={chat.open ? "Hide chat" : "Show chat"}
            onClick={chat.toggle}
          >
            <HugeiconsIcon icon={Message01Icon} strokeWidth={2} />
          </Button>
          {!chat.open && <CallChatUnreadBadge count={chat.unread} />}
        </div>
      )}
      <Button
        size="icon-sm"
        variant="destructive"
        aria-label="Leave call"
        onClick={onLeave}
      >
        <HugeiconsIcon icon={CallEnd01Icon} strokeWidth={2} />
      </Button>
    </div>
  )
}

function FloatingWindow({ call }: { call: ActiveVoiceCall }) {
  const { leave } = useVoiceCall()
  const { isMicrophoneEnabled } = useLocalParticipant()
  const navigate = useNavigate()
  const viewport = useViewport()
  const [share] = useTracks([Track.Source.ScreenShare])
  const size = share ? SHARE : PERSON
  const corner = useRef(readCorner())
  const start = cornerPosition(corner.current, size, viewport)
  const x = useMotionValue(start.x)
  const y = useMotionValue(start.y)
  const width = useMotionValue(size.width)
  const height = useMotionValue(size.height)
  const dragControls = useDragControls()
  // A click that ends a drag doesn't open the call.
  const dragged = useRef(false)

  // A share starting or ending, or the browser resizing, settles the window
  // into its corner at the new size.
  useEffect(() => {
    const to = cornerPosition(corner.current, size, viewport)
    const moves = [
      animate(x, to.x, RESHAPE),
      animate(y, to.y, RESHAPE),
      animate(width, size.width, RESHAPE),
      animate(height, size.height, RESHAPE),
    ]
    return () => {
      for (const move of moves) move.stop()
    }
  }, [size, viewport, x, y, width, height])

  return (
    <motion.div
      drag
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      onDragStart={() => {
        dragged.current = true
      }}
      onDragEnd={(_, info) => {
        const projectedX = x.get() + info.velocity.x * FLICK_SECONDS
        const projectedY = y.get() + info.velocity.y * FLICK_SECONDS
        const next = {
          right: projectedX + size.width / 2 > viewport.width / 2,
          bottom: projectedY + size.height / 2 > viewport.height / 2,
        }
        corner.current = next
        saveCorner(next)
        const to = cornerPosition(next, size, viewport)
        animate(x, to.x, {
          ...SNAP,
          velocity: speedToward(x.get(), to.x, info.velocity.x),
        })
        animate(y, to.y, {
          ...SNAP,
          velocity: speedToward(y.get(), to.y, info.velocity.y),
        })
      }}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      style={{ x, y, width, height }}
      className="group/call-window fixed top-0 left-0 z-40 overflow-hidden rounded-xl border border-border bg-card shadow-lg"
    >
      <button
        type="button"
        aria-label={`Back to the call in ${call.channelName}. Drag to move it.`}
        className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={(event) => {
          dragged.current = false
          dragControls.start(event)
        }}
        onClick={() => {
          if (dragged.current) return
          void navigate({
            to: "/$workspaceSlug/$channelId",
            params: {
              workspaceSlug: call.workspaceSlug,
              channelId: call.channelId,
            },
          })
        }}
      >
        <WindowContent share={share} />
      </button>
      {!isMicrophoneEnabled && (
        <span className="pointer-events-none absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-background/80 text-destructive-foreground">
          <HugeiconsIcon
            icon={MicOff01Icon}
            strokeWidth={2}
            className="size-3.5"
          />
          <span className="sr-only">Muted</span>
        </span>
      )}
      <WindowControls onLeave={() => void leave()} />
    </motion.div>
  )
}

// Floats over the app while this device is in a call, except on the call's
// own page, like Discord's and Slack's call windows and the phone's tile.
// Drag it to any corner; click it to go back to the call. Mute, chat, and
// leave show on hover.
export function CallWindow() {
  const { call } = useVoiceCall()
  const { workspaceSlug, channelId } = useParams({ strict: false })
  const onCallPage =
    call !== null &&
    workspaceSlug === call.workspaceSlug &&
    channelId === call.channelId

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

  return (
    <AnimatePresence>
      {call && !onCallPage && (
        <FloatingWindow key={call.sessionId} call={call} />
      )}
    </AnimatePresence>
  )
}
