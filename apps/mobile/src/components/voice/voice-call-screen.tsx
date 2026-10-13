import CameraRotated01Icon from "@hugeicons/core-free-icons/CameraRotated01Icon"
import FullScreenIcon from "@hugeicons/core-free-icons/FullScreenIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import {
  isTrackReference,
  type TrackReferenceOrPlaceholder,
  useIsSpeaking,
  useLocalParticipant,
  useTracks,
  VideoTrack,
} from "@livekit/react-native"
import { router } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import { cn } from "heroui-native/utils"
import { Track } from "livekit-client"
import { useEffect, useMemo, useState } from "react"
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native"
import type { CallTab } from "@/components/thread-view"
import { Avatar } from "@/components/ui/avatar"
import { IconButton } from "@/components/ui/icon-button"
import { Screen } from "@/components/ui/screen"
import { CallCaptions } from "@/components/voice/call-captions"
import {
  CallSheet,
  useCallSheetPeekHeight,
} from "@/components/voice/call-sheet"
import { LorWindow } from "@/components/voice/lor-window"
import { ReconnectingNotice } from "@/components/voice/reconnecting-notice"
import { ShareViewer } from "@/components/voice/share-viewer"
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
  const { cameraFacing } = useVoiceCall()
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
          mirror={participant.isLocal && cameraFacing === "user"}
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
  const { onStage: lorRequest, results } = useVoiceRequests(sessionId)
  const { captionsOn } = useVoiceCall()
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
  const foreground = useThemeColor("foreground")
  const [viewingShare, setViewingShare] = useState(false)
  const sharerName =
    screenShare?.participant.name || screenShare?.participant.identity || ""
  // A share that ends closes the viewer; the next one starts on the stage.
  useEffect(() => {
    if (!screenShare) setViewingShare(false)
  }, [screenShare])

  // Room at the bottom for the drawer's controls.
  return (
    <View className="flex-1" style={{ paddingBottom: peekHeight }}>
      {screenShare && (
        <Pressable
          accessibilityHint="Opens the screen share full screen"
          accessibilityLabel={`${sharerName}'s screen`}
          accessibilityRole="button"
          className="bg-surface-secondary"
          onPress={() => setViewingShare(true)}
          style={{ width: windowWidth, height: (windowWidth * 9) / 16 }}
        >
          <VideoTrack
            objectFit="contain"
            style={StyleSheet.absoluteFill}
            trackRef={screenShare}
          />
          <View className="absolute right-two bottom-two size-8 items-center justify-center rounded-lor-sm bg-background/80">
            <HugeiconsIcon
              color={foreground}
              icon={FullScreenIcon}
              size={16}
              strokeWidth={2}
            />
          </View>
        </Pressable>
      )}
      {screenShare && viewingShare ? (
        <ShareViewer
          onClose={() => setViewingShare(false)}
          sharerName={sharerName}
          trackRef={screenShare}
        />
      ) : null}
      {lorRequest && (
        <LorWindow key={lorRequest.id} request={lorRequest} results={results} />
      )}
      {/* Captions sit over the grid, above the drawer's controls. */}
      <View className="flex-1">
        <StageGrid tracks={cameraTracks} />
        {captionsOn ? <CallCaptions /> : null}
      </View>
      <ReconnectingNotice />
    </View>
  )
}

// Front or back camera while yours is on. In the header, like Meet's and
// Discord's, so the controls row keeps its shape.
function FlipCameraButton() {
  const [foreground] = useThemeColor(["foreground"])
  const { isCameraEnabled } = useLocalParticipant()
  const { flipCamera } = useVoiceCall()
  if (!isCameraEnabled) return null
  return (
    <IconButton
      accessibilityLabel="Switch camera"
      onPress={() => void flipCamera()}
      variant="ghost"
    >
      <HugeiconsIcon
        color={foreground}
        icon={CameraRotated01Icon}
        size={20}
        strokeWidth={2}
      />
    </IconButton>
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

  const openThread = (threadRootId: string, tab: CallTab = "chat") =>
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
        {inThisCall ? <FlipCameraButton /> : null}
      </View>
      {inThisCall ? (
        <View className="flex-1">
          <CallStage sessionId={call.sessionId} />
          <CallSheet call={call} onLeave={leave} />
        </View>
      ) : (
        <VoiceLobby
          channelId={channelId}
          channelName={channelName}
          joining={joining}
          onJoin={(devices) => {
            if (!workspace) return
            void join(
              { workspaceId: workspace.id, channelId, channelName },
              devices
            )
          }}
          onOpenCall={openThread}
          otherCallName={call?.channelName}
          workspaceId={workspace?.id}
        />
      )}
    </Screen>
  )
}
