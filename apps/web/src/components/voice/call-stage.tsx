import {
  isTrackReference,
  type TrackReferenceOrPlaceholder,
  useIsSpeaking,
  useTracks,
  VideoTrack,
} from "@livekit/components-react"
import { cn } from "@repo/ui/lib/utils"
import { Track } from "livekit-client"
import { UserAvatar } from "@/components/ui/user-avatar"
import { CallControls } from "@/components/voice/call-controls"

function ParticipantTile({
  trackRef,
}: {
  trackRef: TrackReferenceOrPlaceholder
}) {
  const { participant } = trackRef
  const isSpeaking = useIsSpeaking(participant)
  const showVideo = isTrackReference(trackRef) && !trackRef.publication.isMuted
  const name = participant.name || participant.identity

  return (
    <div
      className={cn(
        "relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-muted ring-2 ring-transparent transition-shadow",
        isSpeaking && "ring-primary"
      )}
    >
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
    </div>
  )
}

export function CallStage() {
  const cameraTracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: true },
  ])
  const [screenShare] = useTracks([Track.Source.ScreenShare])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      {screenShare && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg bg-muted">
          <VideoTrack
            trackRef={screenShare}
            className="size-full object-contain"
          />
        </div>
      )}
      <div
        className={cn(
          "grid gap-3",
          screenShare
            ? "shrink-0 auto-cols-[12rem] grid-flow-col overflow-x-auto"
            : "min-h-0 flex-1 grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] content-center overflow-y-auto"
        )}
      >
        {cameraTracks.map((trackRef) => (
          <ParticipantTile
            key={`${trackRef.participant.identity}:${trackRef.source}`}
            trackRef={trackRef}
          />
        ))}
      </div>
      <CallControls />
    </div>
  )
}
