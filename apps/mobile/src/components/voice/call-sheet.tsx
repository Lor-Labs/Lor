import BottomSheet, {
  ANIMATION_SOURCE,
  type GestureEventHandlerCallbackType,
  useBottomSheetInternal,
  useGestureEventsHandlersDefault,
} from "@gorhom/bottom-sheet"
import CallEnd01Icon from "@hugeicons/core-free-icons/CallEnd01Icon"
import Message01Icon from "@hugeicons/core-free-icons/Message01Icon"
import Mic01Icon from "@hugeicons/core-free-icons/Mic01Icon"
import MicOff01Icon from "@hugeicons/core-free-icons/MicOff01Icon"
import Video01Icon from "@hugeicons/core-free-icons/Video01Icon"
import VideoOffIcon from "@hugeicons/core-free-icons/VideoOffIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useLocalParticipant } from "@livekit/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Alert, Keyboard, Platform, StyleSheet, View } from "react-native"
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { ThreadView } from "@/components/thread-view"
import { triggerHaptic } from "@/components/ui/haptics"
import { IconButton } from "@/components/ui/icon-button"
import { Tabs } from "@/components/ui/tabs"
import { CallTranscript } from "@/components/voice/call-transcript"
import { LorSimulatorButton } from "@/components/voice/lor-simulator"
import {
  type ActiveVoiceCall,
  useVoiceCall,
} from "@/context/voice-call-context"

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
  const { cameraFacing } = useVoiceCall()

  const toggleMicrophone = async () => {
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)
    } catch {
      Alert.alert("Microphone unavailable")
    }
  }
  const toggleCamera = async () => {
    try {
      await localParticipant.setCameraEnabled(!isCameraEnabled, {
        facingMode: cameraFacing,
      })
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

// Where the drawer docks in the area below the header: a little over halfway,
// like Discord's, and up to a thin strip of the call under the header.
const MIDDLE = 0.6
const TOP_GAP = 12
const MIDDLE_INDEX = 1
const TOP_INDEX = 2
// Slightly underdamped (ratio ~0.8) and clamped, carrying the release speed:
// it reaches a dock in about 0.2s and stops dead there, never bouncing past.
// A critically damped spring only creeps in, which felt soft.
const SNAP_SPRING = {
  mass: 1,
  stiffness: 420,
  damping: 33,
  overshootClamping: true,
}
const SHRINK_MS = 120
// From the bottom, a drag (flick included) this share of the way up opens the
// drawer.
const OPEN_THRESHOLD = 0.15
// How far a flick carries, as in gorhom's own snapping.
const FLICK_SECONDS = 0.2

// Where a release lands. From the bottom the drawer always opens to the top,
// never stopping halfway, like Discord's; the middle dock is only reached by
// letting go near it on the way down. Otherwise gorhom's default handlers.
function useCallSheetGestures() {
  const defaults = useGestureEventsHandlersDefault()
  const { animatedDetentsState, animatedPosition, animateToPosition } =
    useBottomSheetInternal()
  const startPosition = useSharedValue(0)

  const handleOnStart: GestureEventHandlerCallbackType = useCallback(
    function handleOnStart(source, payload) {
      "worklet"
      startPosition.value = animatedPosition.value
      defaults.handleOnStart(source, payload)
    },
    [defaults, startPosition, animatedPosition]
  )
  const handleOnEnd: GestureEventHandlerCallbackType = useCallback(
    function handleOnEnd(_source, { velocityY }) {
      "worklet"
      const { detents } = animatedDetentsState.get()
      if (!detents || detents.length <= TOP_INDEX) return
      // Positions from the top of the drawer's area: smaller is higher.
      const peek = detents[0] ?? 0
      const top = detents[TOP_INDEX] ?? 0
      const position = animatedPosition.value
      const projected = position + FLICK_SECONDS * velocityY
      let destination = peek
      if (Math.abs(startPosition.value - peek) < 1) {
        const travelled = (peek - projected) / (peek - top)
        destination = travelled > OPEN_THRESHOLD ? top : peek
      } else {
        for (const detent of detents) {
          if (
            Math.abs(detent - projected) < Math.abs(destination - projected)
          ) {
            destination = detent
          }
        }
      }
      if (destination === position) return
      animateToPosition(destination, ANIMATION_SOURCE.GESTURE, velocityY / 2)
    },
    [animatedDetentsState, animatedPosition, animateToPosition, startPosition]
  )

  return { ...defaults, handleOnStart, handleOnEnd }
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
  const indexRef = useRef(0)
  const dockedRef = useRef(false)
  const [containerHeight, setContainerHeight] = useState(0)
  const [tab, setTab] = useState<"chat" | "transcript">("chat")
  const [open, setOpen] = useState(false)
  // The chat and transcript mount the first time the drawer opens.
  const [opened, setOpened] = useState(false)
  // The top dock is a fixed gap below the header, so it needs the measured
  // area; before that, a close stand-in.
  const topHeight = containerHeight > 0 ? containerHeight - TOP_GAP : "98%"
  const snapPoints = useMemo(
    () => [peekHeight, `${MIDDLE * 100}%`, topHeight],
    [peekHeight, topHeight]
  )

  // The sheet library sizes content for the top dock, which would leave the
  // composer and newest messages below the screen at the middle one. So the
  // content takes each dock's visible height: right away when the drawer
  // rises (the rise reveals it), and once it settles when it lowers.
  const contentHeight = useSharedValue(0)
  const visibleContentHeight = useCallback(
    (index: number) => {
      const sheetHeight =
        index === TOP_INDEX
          ? containerHeight - TOP_GAP
          : index === MIDDLE_INDEX
            ? containerHeight * MIDDLE
            : peekHeight
      return Math.max(0, sheetHeight - GRABBER_HEIGHT - CONTROLS_HEIGHT)
    },
    [containerHeight, peekHeight]
  )
  const contentSizeStyle = useAnimatedStyle(() => ({
    height: contentHeight.value,
  }))

  const toggleChat = useCallback(() => {
    if (open) {
      sheetRef.current?.snapToIndex(0)
      return
    }
    setTab("chat")
    sheetRef.current?.snapToIndex(TOP_INDEX)
  }, [open])

  // Typing needs the room: the composer's keyboard lifts the drawer to the
  // top dock.
  useEffect(() => {
    const event = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow"
    const subscription = Keyboard.addListener(event, () => {
      if (indexRef.current === MIDDLE_INDEX) {
        sheetRef.current?.snapToIndex(TOP_INDEX)
      }
    })
    return () => subscription.remove()
  }, [])

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
    <View
      onLayout={(event) => setContainerHeight(event.nativeEvent.layout.height)}
      pointerEvents="box-none"
      style={StyleSheet.absoluteFill}
    >
      <BottomSheet
        animatedIndex={animatedIndex}
        animationConfigs={SNAP_SPRING}
        backgroundStyle={{ backgroundColor: surface, borderRadius: 18 }}
        enableContentPanningGesture={false}
        enableDynamicSizing={false}
        enablePanDownToClose={false}
        handleComponent={renderHandle}
        index={0}
        gestureEventsHandlersHook={useCallSheetGestures}
        // Haptics like Discord's: one as the drawer zips open, one as it lands
        // at the bottom, none for the middle dock.
        onAnimate={(fromIndex, toIndex) => {
          indexRef.current = toIndex
          if (
            toIndex === TOP_INDEX &&
            fromIndex >= 0 &&
            fromIndex < TOP_INDEX
          ) {
            triggerHaptic("medium")
          }
          if (toIndex > fromIndex) {
            contentHeight.value = visibleContentHeight(toIndex)
          }
          setOpen(toIndex > 0)
          if (toIndex > 0) setOpened(true)
        }}
        onChange={(index) => {
          // The clamped spring ends the moment it reaches the dock, so this
          // lands with the visual stop. The first dock is the mount.
          if (index === 0 && dockedRef.current) triggerHaptic("medium")
          dockedRef.current = true
          contentHeight.value = withTiming(visibleContentHeight(index), {
            duration: SHRINK_MS,
          })
        }}
        ref={sheetRef}
        snapPoints={snapPoints}
      >
        {/* Bottom padding like a screen's safe area: the chat's keyboard
            layout lifts the composer by the keyboard height minus this
            inset. */}
        <Animated.View
          pointerEvents={open ? "auto" : "none"}
          style={[
            contentStyle,
            contentSizeStyle,
            { paddingBottom: bottomInset },
          ]}
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
    </View>
  )
}
