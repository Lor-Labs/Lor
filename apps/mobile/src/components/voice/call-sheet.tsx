import BottomSheet from "@gorhom/bottom-sheet"
import CallEnd01Icon from "@hugeicons/core-free-icons/CallEnd01Icon"
import Message01Icon from "@hugeicons/core-free-icons/Message01Icon"
import Mic01Icon from "@hugeicons/core-free-icons/Mic01Icon"
import MicOff01Icon from "@hugeicons/core-free-icons/MicOff01Icon"
import Video01Icon from "@hugeicons/core-free-icons/Video01Icon"
import VideoOffIcon from "@hugeicons/core-free-icons/VideoOffIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useLocalParticipant } from "@livekit/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { useCallback, useMemo, useRef, useState } from "react"
import { Alert, View } from "react-native"
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { ThreadView } from "@/components/thread-view"
import { IconButton } from "@/components/ui/icon-button"
import { Tabs } from "@/components/ui/tabs"
import { CallTranscript } from "@/components/voice/call-transcript"
import { LorSimulatorButton } from "@/components/voice/lor-simulator"
import type { ActiveVoiceCall } from "@/context/voice-call-context"

const GRABBER_HEIGHT = 20
const CONTROLS_HEIGHT = 64

// What the drawer shows when pulled down: the grabber and the call controls.
// The stage leaves this much room at the bottom.
export function useCallSheetPeekHeight() {
  const { bottom } = useSafeAreaInsets()
  return GRABBER_HEIGHT + CONTROLS_HEIGHT + bottom
}

function CallControls({
  sessionId,
  chatOpen,
  onToggleChat,
  onLeave,
}: {
  sessionId: string
  chatOpen: boolean
  onToggleChat: () => void
  onLeave: () => void
}) {
  const [foreground, danger, accent] = useThemeColor([
    "foreground",
    "danger",
    "accent",
  ])
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } =
    useLocalParticipant()

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
    <View
      className="flex-row items-center justify-center gap-four"
      style={{ height: CONTROLS_HEIGHT }}
    >
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
      <LorSimulatorButton sessionId={sessionId} />
      <IconButton
        accessibilityLabel={chatOpen ? "Close call chat" : "Open call chat"}
        onPress={onToggleChat}
        variant="secondary"
      >
        <HugeiconsIcon
          color={chatOpen ? accent : foreground}
          icon={Message01Icon}
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
  )
}

// The drawer under a call's stage, like Discord's: pulled down it's the call
// controls; pulled up (or Chat tapped) it holds the call chat and transcript
// while the call stays on screen above it. Only the controls strip drags it,
// so the chat and transcript scroll freely.
export function CallSheet({
  call,
  onLeave,
}: {
  call: ActiveVoiceCall
  onLeave: () => void
}) {
  const surface = useThemeColor("surface")
  const muted = useThemeColor("muted")
  const { bottom: bottomInset } = useSafeAreaInsets()
  const peekHeight = useCallSheetPeekHeight()
  const sheetRef = useRef<BottomSheet>(null)
  const animatedIndex = useSharedValue(0)
  const [tab, setTab] = useState<"chat" | "transcript">("chat")
  const [open, setOpen] = useState(false)
  // The chat and transcript mount the first time the drawer opens.
  const [opened, setOpened] = useState(false)
  const snapPoints = useMemo(() => [peekHeight, "92%"], [peekHeight])

  const toggleChat = useCallback(() => {
    if (open) {
      sheetRef.current?.snapToIndex(0)
      return
    }
    setTab("chat")
    sheetRef.current?.snapToIndex(1)
  }, [open])

  const renderHandle = useCallback(
    () => (
      <View>
        <View
          className="items-center justify-end"
          style={{ height: GRABBER_HEIGHT }}
        >
          <View
            className="h-[5px] w-9 rounded-full"
            style={{ backgroundColor: muted, opacity: 0.4 }}
          />
        </View>
        <CallControls
          chatOpen={open}
          onLeave={onLeave}
          onToggleChat={toggleChat}
          sessionId={call.sessionId}
        />
      </View>
    ),
    [muted, open, onLeave, toggleChat, call.sessionId]
  )

  // The tabs and their content fade in as the drawer rises.
  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      animatedIndex.value,
      [0, 0.5],
      [0, 1],
      Extrapolation.CLAMP
    ),
  }))

  return (
    <BottomSheet
      animatedIndex={animatedIndex}
      backgroundStyle={{ backgroundColor: surface, borderRadius: 18 }}
      enableContentPanningGesture={false}
      enableDynamicSizing={false}
      enablePanDownToClose={false}
      handleComponent={renderHandle}
      index={0}
      onChange={(index) => {
        setOpen(index > 0)
        if (index > 0) setOpened(true)
      }}
      ref={sheetRef}
      snapPoints={snapPoints}
    >
      {/* Bottom padding like a screen's safe area: the chat's keyboard
          layout lifts the composer by the keyboard height minus this inset. */}
      <Animated.View
        className="flex-1"
        pointerEvents={open ? "auto" : "none"}
        style={[contentStyle, { paddingBottom: bottomInset }]}
      >
        <View className="border-b border-separator px-four pb-two">
          <Tabs
            onValueChange={(value) =>
              setTab(value === "transcript" ? "transcript" : "chat")
            }
            value={tab}
          >
            <Tabs.List>
              <Tabs.Indicator />
              <Tabs.Trigger value="chat">
                <Tabs.Label>Chat</Tabs.Label>
              </Tabs.Trigger>
              <Tabs.Trigger value="transcript">
                <Tabs.Label>Transcript</Tabs.Label>
              </Tabs.Trigger>
            </Tabs.List>
          </Tabs>
        </View>
        {/* The chat stays mounted behind the transcript, so a half-written
            message survives a tab switch. */}
        {opened && call.threadRootId ? (
          <View className={tab === "chat" ? "flex-1" : "hidden"}>
            <ThreadView
              channelId={call.channelId}
              embedded
              threadRootId={call.threadRootId}
            />
          </View>
        ) : null}
        {opened && tab === "transcript" ? (
          <CallTranscript live sessionId={call.sessionId} />
        ) : null}
      </Animated.View>
    </BottomSheet>
  )
}
