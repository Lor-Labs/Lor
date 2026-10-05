import CallEnd01Icon from "@hugeicons/core-free-icons/CallEnd01Icon"
import Message01Icon from "@hugeicons/core-free-icons/Message01Icon"
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import { LorSimulatorButton } from "@/components/voice/lor-simulator"
import { LorWindow } from "@/components/voice/lor-window"
import { useSocket } from "@/context/socket-context"
import { useVoiceRequests } from "@/hooks/use-voice-requests"
import { api, responseMessage } from "@/lib/api"
import { holdThreadRoom } from "@/lib/thread-rooms"

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
  // The joined session and its call chat, from the join response.
  const [session, setSession] = useState<{
    sessionId: string
    threadRootId: string | null
  } | null>(null)
  const sessionRef = useRef(session)
  sessionRef.current = session
  // Set when the screen closes, so a join still in flight can't leave a call
  // and microphone running without it.
  const closedRef = useRef(false)
  const socket = useSocket()

  // Tells the server right away; the LiveKit webhook is the fallback.
  const leave = useCallback(async () => {
    const current = sessionRef.current
    await room.disconnect()
    if (!current) return
    await api.v1.voice.sessions[":sessionId"].leave
      .$post({ param: { sessionId: current.sessionId } })
      .catch(() => undefined)
  }, [room])

  useEffect(() => {
    closedRef.current = false
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
      closedRef.current = true
      room.off(RoomEvent.Disconnected, handleDisconnected)
      void leave()
    }
  }, [room, leave])

  // The call chat's room carries the chat and Lor's window, so it's held for
  // the whole call, not just while the chat is open.
  const threadRootId = connected ? session?.threadRootId : null
  useEffect(() => {
    if (!socket || !threadRootId) return
    const release = holdThreadRoom(socket, threadRootId)
    const rejoin = () => socket.emit("thread:join", { threadRootId })
    socket.on("connect", rejoin)
    return () => {
      socket.off("connect", rejoin)
      release()
    }
  }, [socket, threadRootId])

  const openChat = threadRootId
    ? () =>
        router.push({
          pathname: "/channel/[channelId]/thread/[threadRootId]",
          params: { channelId, threadRootId },
        } as never)
    : undefined

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
      const { url, token, sessionId, threadRootId } = await response.json()
      if (closedRef.current) return
      setSession({ sessionId, threadRootId })
      await room.connect(url, token)
      if (closedRef.current) {
        void room.disconnect()
        return
      }
      setConnected(true)
      try {
        await room.localParticipant.setMicrophoneEnabled(true)
      } catch {
        Alert.alert("Microphone unavailable", "You can still listen.")
      }
    } catch (error) {
      if (closedRef.current) return
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
          <CallStage
            onLeave={() => void leave()}
            onOpenChat={openChat}
            sessionId={session?.sessionId ?? null}
          />
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
