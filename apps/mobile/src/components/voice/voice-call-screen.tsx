import CallEnd01Icon from "@hugeicons/core-free-icons/CallEnd01Icon"
import Message01Icon from "@hugeicons/core-free-icons/Message01Icon"
import Mic01Icon from "@hugeicons/core-free-icons/Mic01Icon"
import MicOff01Icon from "@hugeicons/core-free-icons/MicOff01Icon"
import Video01Icon from "@hugeicons/core-free-icons/Video01Icon"
import VideoOffIcon from "@hugeicons/core-free-icons/VideoOffIcon"
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
import { useMemo } from "react"
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native"
import { Avatar } from "@/components/ui/avatar"
import { IconButton } from "@/components/ui/icon-button"
import { Screen } from "@/components/ui/screen"
import { LorSimulatorButton } from "@/components/voice/lor-simulator"
import { LorWindow } from "@/components/voice/lor-window"
import { VoiceLobby } from "@/components/voice/voice-lobby"
import { useVoiceCall } from "@/context/voice-call-context"
import { useWorkspace } from "@/context/workspace-context"
import { useVoiceRequests } from "@/hooks/use-voice-requests"

// The `three` spacing token (12pt), used for the grid's padding and gap.
// aspectRatio gave these tiles no height on device, so they're sized here.
const TILE_GAP = 12

function ParticipantTile({
  trackRef,
  width,
}: {
  trackRef: TrackReferenceOrPlaceholder
  width: number
}) {
  const { participant } = trackRef
  const isSpeaking = useIsSpeaking(participant)
  const showVideo = isTrackReference(trackRef) && !trackRef.publication.isMuted
  const name = participant.name || participant.identity

  return (
    <View
      className={cn(
        "overflow-hidden rounded-lor-sm border-2 bg-surface-secondary",
        isSpeaking ? "border-accent" : "border-transparent"
      )}
      style={{ width, height: (width * 4) / 3 }}
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
          <Avatar name={name} size="md" />
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

function CallStage({
  sessionId,
  onLeave,
  onOpenChat,
}: {
  sessionId: string | null
  onLeave: () => void
  onOpenChat?: () => void
}) {
  const lorRequest = useVoiceRequests(sessionId)
  const [foreground, danger] = useThemeColor(["foreground", "danger"])
  const allCameraTracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: true },
  ])
  // The transcriber joins as an agent participant; it never gets a tile.
  const cameraTracks = useMemo(
    () => allCameraTracks.filter((trackRef) => !trackRef.participant.isAgent),
    [allCameraTracks]
  )
  const [screenShare] = useTracks([Track.Source.ScreenShare])
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } =
    useLocalParticipant()
  const { width: windowWidth } = useWindowDimensions()
  const tileWidth = (windowWidth - TILE_GAP * 3) / 2

  const toggleMicrophone = async () => {
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)
    } catch {
      Alert.alert("Microphone unavailable")
    }
  }
  const toggleCamera = async () => {
    try {
      await localParticipant.setCameraEnabled(!isCameraEnabled)
    } catch {
      Alert.alert("Camera unavailable")
    }
  }

  return (
    <View className="flex-1">
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
      <ScrollView contentContainerClassName="flex-row flex-wrap gap-three p-three">
        {cameraTracks.map((trackRef) => (
          <ParticipantTile
            key={`${trackRef.participant.identity}:${trackRef.source}`}
            trackRef={trackRef}
            width={tileWidth}
          />
        ))}
      </ScrollView>
      <View className="flex-row items-center justify-center gap-four border-t border-separator p-three">
        <IconButton
          accessibilityLabel={isMicrophoneEnabled ? "Mute" : "Unmute"}
          onPress={() => void toggleMicrophone()}
          variant="secondary"
        >
          <HugeiconsIcon
            color={foreground}
            icon={isMicrophoneEnabled ? Mic01Icon : MicOff01Icon}
            size={20}
            strokeWidth={2}
          />
        </IconButton>
        <IconButton
          accessibilityLabel={
            isCameraEnabled ? "Turn camera off" : "Turn camera on"
          }
          onPress={() => void toggleCamera()}
          variant="secondary"
        >
          <HugeiconsIcon
            color={foreground}
            icon={isCameraEnabled ? Video01Icon : VideoOffIcon}
            size={20}
            strokeWidth={2}
          />
        </IconButton>
        {sessionId && <LorSimulatorButton sessionId={sessionId} />}
        {onOpenChat && (
          <IconButton
            accessibilityLabel="Open call chat"
            onPress={onOpenChat}
            variant="secondary"
          >
            <HugeiconsIcon
              color={foreground}
              icon={Message01Icon}
              size={20}
              strokeWidth={2}
            />
          </IconButton>
        )}
        <IconButton
          accessibilityLabel="Leave call"
          onPress={onLeave}
          variant="danger-soft"
        >
          <HugeiconsIcon
            color={danger}
            icon={CallEnd01Icon}
            size={20}
            strokeWidth={2}
          />
        </IconButton>
      </View>
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

  const openThread = (threadRootId: string) =>
    router.push({
      pathname: "/channel/[channelId]/thread/[threadRootId]",
      params: { channelId, threadRootId },
    } as never)
  const callChatId = inThisCall ? call.threadRootId : null

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
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
        <CallStage
          onLeave={() => void leave()}
          onOpenChat={callChatId ? () => openThread(callChatId) : undefined}
          sessionId={call.sessionId}
        />
      ) : (
        <VoiceLobby
          channelId={channelId}
          joining={joining}
          onJoin={() => {
            if (!workspace) return
            void join({ workspaceId: workspace.id, channelId, channelName })
          }}
          onOpenChat={openThread}
          otherCallName={call?.channelName}
          workspaceId={workspace?.id}
        />
      )}
    </Screen>
  )
}
