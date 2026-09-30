import CallEnd01Icon from "@hugeicons/core-free-icons/CallEnd01Icon"
import Mic01Icon from "@hugeicons/core-free-icons/Mic01Icon"
import MicOff01Icon from "@hugeicons/core-free-icons/MicOff01Icon"
import Video01Icon from "@hugeicons/core-free-icons/Video01Icon"
import VideoOffIcon from "@hugeicons/core-free-icons/VideoOffIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import {
  isTrackReference,
  RoomContext,
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
import { DisconnectReason, Room, RoomEvent, Track } from "livekit-client"
import { useEffect, useState } from "react"
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Screen } from "@/components/ui/screen"
import { api, responseMessage } from "@/lib/api"

// The `three` spacing token (12pt), used for the grid's padding and gap.
// aspectRatio gave these tiles no height on device, so they're sized here.
const TILE_GAP = 12

function disconnectMessage(reason: DisconnectReason) {
  switch (reason) {
    case DisconnectReason.DUPLICATE_IDENTITY:
      return "The call moved to another device."
    case DisconnectReason.PARTICIPANT_REMOVED:
      return "You were removed from the call."
    default:
      return `The call ended (${DisconnectReason[reason] ?? "unknown reason"}).`
  }
}

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

function CallStage({ onLeave }: { onLeave: () => void }) {
  const [foreground, danger] = useThemeColor(["foreground", "danger"])
  const cameraTracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: true },
  ])
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

// V0 spike: the call lives with this screen. V6 moves it to an app-level
// provider with a persistent call pill.
export function VoiceCallScreen({
  channelId,
  channelName,
}: {
  channelId: string
  channelName: string
}) {
  const [foreground] = useThemeColor(["foreground"])
  const [room] = useState(
    () => new Room({ adaptiveStream: true, dynacast: true })
  )
  const [connected, setConnected] = useState(false)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    const handleDisconnected = (reason?: DisconnectReason) => {
      setConnected(false)
      if (
        reason !== undefined &&
        reason !== DisconnectReason.CLIENT_INITIATED
      ) {
        Alert.alert("Call ended", disconnectMessage(reason))
      }
    }
    room.on(RoomEvent.Disconnected, handleDisconnected)
    return () => {
      room.off(RoomEvent.Disconnected, handleDisconnected)
      void room.disconnect()
    }
  }, [room])

  const join = async () => {
    setJoining(true)
    try {
      const response = await api.v1.channels[":channelId"].voice.join.$post({
        param: { channelId },
      })
      if (!response.ok) {
        throw new Error(
          await responseMessage(response, "Could not join the call")
        )
      }
      const { url, token } = await response.json()
      await room.connect(url, token)
      setConnected(true)
      try {
        await room.localParticipant.setMicrophoneEnabled(true)
      } catch {
        Alert.alert("Microphone unavailable", "You can still listen.")
      }
    } catch (error) {
      Alert.alert(
        "Could not join the call",
        error instanceof Error ? error.message : "Try again."
      )
    } finally {
      setJoining(false)
    }
  }

  return (
    <RoomContext.Provider value={room}>
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
        {connected ? (
          <CallStage onLeave={() => void room.disconnect()} />
        ) : (
          <View className="flex-1 items-center justify-center">
            <Button isDisabled={joining} onPress={() => void join()}>
              <Button.Label>{joining ? "Joining…" : "Join"}</Button.Label>
            </Button>
          </View>
        )}
      </Screen>
    </RoomContext.Provider>
  )
}
