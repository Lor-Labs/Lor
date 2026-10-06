import {
  isTrackReference,
  type TrackReferenceOrPlaceholder,
  useIsSpeaking,
  useTracks,
  VideoTrack,
} from "@livekit/react-native"
import { router } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import { cn } from "heroui-native/utils"
import { Track } from "livekit-client"
import { useMemo, useState } from "react"
import {
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native"
import { Avatar } from "@/components/ui/avatar"
import { IconButton } from "@/components/ui/icon-button"
import { Screen } from "@/components/ui/screen"
import {
  CallSheet,
  useCallSheetPeekHeight,
} from "@/components/voice/call-sheet"
import { LorWindow } from "@/components/voice/lor-window"
import { VoiceLobby } from "@/components/voice/voice-lobby"
import { useVoiceCall } from "@/context/voice-call-context"
import { useWorkspace } from "@/context/workspace-context"
import { useVoiceRequests } from "@/hooks/use-voice-requests"

// The `three` spacing token (12pt), the grid's padding and gap.
const TILE_GAP = 12
// Up to this many people fill the stage; more scroll.
const FILL_LIMIT = 4
const SCROLL_ROWS_PER_SCREEN = 3

const tileKey = (trackRef: TrackReferenceOrPlaceholder) =>
  `${trackRef.participant.identity}:${trackRef.source}`

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
    <View
      className={cn(
        "flex-1 overflow-hidden rounded-lor-md border-2 bg-surface-secondary",
        isSpeaking ? "border-accent" : "border-transparent"
      )}
    >
      {showVideo ? (
        <VideoTrack
          mirror={participant.isLocal}
          objectFit="cover"
          style={StyleSheet.absoluteFill}
          trackRef={trackRef}
        />
      ) : (
        <View
          className="items-center justify-center"
          style={StyleSheet.absoluteFill}
        >
          <Avatar name={name} size="lg" />
        </View>
      )}
      <View className="absolute bottom-two left-two max-w-[85%] rounded-lor-sm bg-background/80 px-one">
        <Text
          className="text-[12px] font-medium text-foreground"
          numberOfLines={1}
        >
          {name}
        </Text>
      </View>
    </View>
  )
}

// Alone, you fill the stage; two people get half each, stacked; three or four
// share a two-by-two grid, an odd last tile spanning its row. Past four, rows
// of two scroll, three rows to a screen.
function StageGrid({ tracks }: { tracks: TrackReferenceOrPlaceholder[] }) {
  const [height, setHeight] = useState(0)
  const columns = tracks.length <= 2 ? 1 : 2
  const rows: TrackReferenceOrPlaceholder[][] = []
  for (let index = 0; index < tracks.length; index += columns) {
    rows.push(tracks.slice(index, index + columns))
  }
  const renderRow = (row: TrackReferenceOrPlaceholder[], fixed?: number) => (
    <View
      className={cn("flex-row gap-three", fixed === undefined && "flex-1")}
      key={row.map(tileKey).join("|")}
      style={fixed === undefined ? undefined : { height: fixed }}
    >
      {row.map((trackRef) => (
        <ParticipantTile key={tileKey(trackRef)} trackRef={trackRef} />
      ))}
    </View>
  )

  if (tracks.length <= FILL_LIMIT) {
    return (
      <View className="flex-1 gap-three p-three">
        {rows.map((row) => renderRow(row))}
      </View>
    )
  }
  const rowHeight =
    (height - TILE_GAP * (SCROLL_ROWS_PER_SCREEN + 1)) / SCROLL_ROWS_PER_SCREEN
  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="gap-three p-three"
      onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
    >
      {height > 0 ? rows.map((row) => renderRow(row, rowHeight)) : null}
    </ScrollView>
  )
}

function CallStage({ sessionId }: { sessionId: string }) {
  const lorRequest = useVoiceRequests(sessionId)
  const peekHeight = useCallSheetPeekHeight()
  const allCameraTracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: true },
  ])
  // The transcriber joins as an agent participant; it never gets a tile.
  const cameraTracks = useMemo(
    () => allCameraTracks.filter((trackRef) => !trackRef.participant.isAgent),
    [allCameraTracks]
  )
  const [screenShare] = useTracks([Track.Source.ScreenShare])
  const { width: windowWidth } = useWindowDimensions()

  // Room at the bottom for the drawer's controls.
  return (
    <View className="flex-1" style={{ paddingBottom: peekHeight }}>
      {screenShare && (
        <View
          className="bg-surface-secondary"
          style={{ width: windowWidth, height: (windowWidth * 9) / 16 }}
        >
          <VideoTrack
            objectFit="contain"
            style={StyleSheet.absoluteFill}
            trackRef={screenShare}
          />
        </View>
      )}
      {lorRequest && <LorWindow key={lorRequest.id} request={lorRequest} />}
      <StageGrid tracks={cameraTracks} />
    </View>
  )
}

// The call itself lives in VoiceCallProvider, so leaving this screen keeps
// it; the floating call tile brings you back.
export function VoiceCallScreen({
  channelId,
  channelName,
}: {
  channelId: string
  channelName: string
}) {
  const [foreground] = useThemeColor(["foreground"])
  const { workspace } = useWorkspace()
  const { call, joining, join, leave } = useVoiceCall()
  const inThisCall = call?.channelId === channelId

  const openThread = (
    threadRootId: string,
    tab: "chat" | "transcript" = "chat"
  ) =>
    router.push({
      pathname: "/channel/[channelId]/thread/[threadRootId]",
      params: { channelId, threadRootId, tab },
    } as never)

  return (
    // In a call, the drawer reaches the bottom edge and pads itself.
    <Screen
      className="bg-background"
      edges={inThisCall ? ["top"] : ["top", "bottom"]}
    >
      <View className="min-h-[60px] flex-row items-center gap-two border-b border-separator px-three">
        <IconButton
          accessibilityLabel="Back to channels"
          onPress={() => router.back()}
          variant="ghost"
        >
          <SymbolView
            name={{
              ios: "chevron.left",
              android: "arrow_back",
              web: "arrow_back",
            }}
            size={21}
            tintColor={foreground}
          />
        </IconButton>
        <Text
          className="flex-1 text-[17px] font-bold tracking-[-0.2px] text-foreground"
          numberOfLines={1}
        >
          {channelName}
        </Text>
      </View>
      {inThisCall ? (
        <View className="flex-1">
          <CallStage sessionId={call.sessionId} />
          <CallSheet call={call} onLeave={leave} />
        </View>
      ) : (
        <VoiceLobby
          channelId={channelId}
          joining={joining}
          onJoin={() => {
            if (!workspace) return
            void join({ workspaceId: workspace.id, channelId, channelName })
          }}
          onOpenCall={openThread}
          otherCallName={call?.channelName}
          workspaceId={workspace?.id}
        />
      )}
    </Screen>
  )
}
