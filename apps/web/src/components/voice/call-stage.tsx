import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  MoreHorizontalIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  isTrackReference,
  type TrackReferenceOrPlaceholder,
  useIsSpeaking,
  usePagination,
  useTracks,
  useVisualStableUpdate,
  VideoTrack,
} from "@livekit/components-react"
import { Button } from "@repo/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/menu"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { Track } from "livekit-client"
import { AnimatePresence } from "motion/react"
import { useEffect, useMemo, useRef, useState } from "react"
import { UserAvatar } from "@/components/ui/user-avatar"
import { CallCaptions } from "@/components/voice/call-captions"
import { CallControls } from "@/components/voice/call-controls"
import { LorStage, LorWindow } from "@/components/voice/lor-window"
import { useVoiceCall } from "@/context/voice-call-context"
import { useVoiceRequests } from "@/hooks/use-voice-requests"
import { apiClient } from "@/lib/api-client"

const PAGE_SIZE = 12
// The speaking ring stays on this long after speech stops, so it doesn't
// flicker off between words.
const SPEAKING_HOLD_MS = 800

function useSpeakingRing(
  participant: TrackReferenceOrPlaceholder["participant"]
) {
  const speaking = useIsSpeaking(participant)
  const [held, setHeld] = useState(speaking)
  useEffect(() => {
    if (speaking) {
      setHeld(true)
      return
    }
    const timer = setTimeout(() => setHeld(false), SPEAKING_HOLD_MS)
    return () => clearTimeout(timer)
  }, [speaking])
  return speaking || held
}

function ParticipantTile({
  trackRef,
  onRemove,
}: {
  trackRef: TrackReferenceOrPlaceholder
  onRemove?: (participantId: string) => void
}) {
  const { participant } = trackRef
  const isSpeaking = useSpeakingRing(participant)
  const showVideo = isTrackReference(trackRef) && !trackRef.publication.isMuted
  const name = participant.name || participant.identity

  return (
    <div className="group/tile relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-muted">
      {showVideo ? (
        <VideoTrack
          trackRef={trackRef}
          className={cn(
            "size-full object-cover",
            participant.isLocal && "-scale-x-100"
          )}
        />
      ) : (
        <UserAvatar name={name} size="md" />
      )}
      <span className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-md bg-background/80 px-1.5 py-0.5 text-xs font-medium">
        {name}
      </span>
      {/* Speaking ring, drawn inside the tile above the video: an outside
          ring gets clipped by the scrolling filmstrip. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 rounded-lg ring-2 ring-transparent ring-inset transition-shadow duration-300",
          isSpeaking && "ring-primary duration-100"
        )}
      />
      {onRemove && !participant.isLocal && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Options for ${name}`}
                className="absolute top-2 right-2 bg-background/80 opacity-0 transition-opacity group-hover/tile:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100"
              />
            }
          >
            <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onRemove(participant.identity)}
            >
              Remove from call
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

export function CallStage({ canModerate }: { canModerate: boolean }) {
  const { call, captionsOn } = useVoiceCall()
  const allCameraTracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: true },
  ])
  // The transcriber joins as an agent participant; it never gets a tile.
  const cameraTracks = useMemo(
    () => allCameraTracks.filter((trackRef) => !trackRef.participant.isAgent),
    [allCameraTracks]
  )
  // Active speakers move onto the current page without reshuffling tiles
  // that are already visible.
  const stableTracks = useVisualStableUpdate(cameraTracks, PAGE_SIZE)
  const page = usePagination(PAGE_SIZE, stableTracks)
  const [screenShare] = useTracks([Track.Source.ScreenShare])
  const { active: lorRequest } = useVoiceRequests(call?.sessionId ?? null)
  // Lor's window takes the screen-share slot, which stays until its exit
  // animation ends.
  const [lorMounted, setLorMounted] = useState(false)
  const lorRequestRef = useRef(lorRequest)
  lorRequestRef.current = lorRequest
  useEffect(() => {
    if (lorRequest) setLorMounted(true)
  }, [lorRequest])
  const showSlot = Boolean(screenShare) || lorRequest !== null || lorMounted

  const removeParticipant = async (participantId: string) => {
    if (!call) return
    const res = await apiClient.v1.workspaces[":workspaceSlug"].voice.sessions[
      ":sessionId"
    ].participants[":participantId"].$delete({
      param: {
        workspaceSlug: call.workspaceSlug,
        sessionId: call.sessionId,
        participantId,
      },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      toast.error(body?.message ?? "Could not remove them from the call")
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="relative flex min-h-0 flex-1 flex-col gap-3">
        {showSlot && (
          <div className="flex min-h-0 flex-1">
            {screenShare && (
              <div className="min-w-0 flex-1 overflow-hidden rounded-lg bg-muted">
                <VideoTrack
                  trackRef={screenShare}
                  className="size-full object-contain"
                />
              </div>
            )}
            <AnimatePresence
              onExitComplete={() => {
                // A request may have arrived while the stage was leaving.
                if (!lorRequestRef.current) setLorMounted(false)
              }}
            >
              {lorRequest && (
                <LorStage key="lor" docked={Boolean(screenShare)}>
                  <AnimatePresence initial={false}>
                    <LorWindow key={lorRequest.id} request={lorRequest} />
                  </AnimatePresence>
                </LorStage>
              )}
            </AnimatePresence>
          </div>
        )}
        <div
          className={cn(
            "grid gap-3",
            showSlot
              ? "shrink-0 auto-cols-[12rem] grid-flow-col overflow-x-auto"
              : "min-h-0 flex-1 grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] content-center overflow-y-auto"
          )}
        >
          {page.tracks.map((trackRef) => (
            <ParticipantTile
              key={`${trackRef.participant.identity}:${trackRef.source}`}
              trackRef={trackRef}
              onRemove={
                canModerate ? (id) => void removeParticipant(id) : undefined
              }
            />
          ))}
        </div>
        {page.totalPageCount > 1 && (
          <div className="flex shrink-0 items-center justify-center gap-2 text-xs text-muted-foreground">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Previous page"
              disabled={page.currentPage <= 1}
              onClick={page.prevPage}
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
            </Button>
            <span>
              {page.currentPage} / {page.totalPageCount}
            </span>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Next page"
              disabled={page.currentPage >= page.totalPageCount}
              onClick={page.nextPage}
            >
              <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
            </Button>
          </div>
        )}
        {captionsOn && <CallCaptions />}
      </div>
      <CallControls />
    </div>
  )
}
