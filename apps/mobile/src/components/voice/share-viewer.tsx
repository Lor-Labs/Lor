import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon"
import OrientationLandscapeToPotraitIcon from "@hugeicons/core-free-icons/OrientationLandscapeToPotraitIcon"
import OrientationPotraitToLandscapeIcon from "@hugeicons/core-free-icons/OrientationPotraitToLandscapeIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { type TrackReference, VideoTrack } from "@livekit/react-native"
import * as ScreenOrientation from "expo-screen-orientation"
import { StatusBar } from "expo-status-bar"
import { useEffect, useState } from "react"
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { scheduleOnRN } from "react-native-worklets"
import { viewerForeground } from "@/components/image-viewer"

const MAX_SCALE = 4
const DOUBLE_TAP_SCALE = 2.5
const RESET_MS = 200
// A drag past this far, or a flick this fast, closes the viewer.
const DISMISS_DISTANCE = 120
const DISMISS_VELOCITY = 900
const DISMISS_MS = 180
// Short of that it snaps back: slightly underdamped and clamped, so it lands
// crisply without bouncing past.
const SNAP_BACK = {
  mass: 1,
  stiffness: 420,
  damping: 33,
  overshootClamping: true,
}

function clamp(value: number, limit: number) {
  "worklet"
  return Math.min(Math.max(value, -limit), limit)
}

function ViewerButton({
  label,
  icon,
  onPress,
}: {
  label: string
  icon: typeof Cancel01Icon
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      className="size-10 items-center justify-center rounded-lor-sm bg-neutral-900/80 active:bg-neutral-800"
      hitSlop={8}
      onPress={onPress}
    >
      <HugeiconsIcon
        color={viewerForeground}
        icon={icon}
        size={20}
        strokeWidth={2}
      />
    </Pressable>
  )
}

// Someone's screen share, full screen. The rest of the app is portrait-only;
// while this is open the screen turns with the phone, and "Landscape" forces
// it sideways for people who keep rotation lock on. Pinch or double-tap to
// zoom into small text; drag to move around while zoomed.
export function ShareViewer({
  trackRef,
  sharerName,
  onClose,
}: {
  trackRef: TrackReference
  sharerName: string
  onClose: () => void
}) {
  const frame = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const landscape = frame.width > frame.height
  const [forcedLandscape, setForcedLandscape] = useState(false)
  const controlsInset = {
    paddingTop: insets.top + 8,
    paddingLeft: insets.left + 16,
    paddingRight: insets.right + 16,
  }

  useEffect(() => {
    void ScreenOrientation.unlockAsync()
    return () => {
      void ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT_UP
      )
    }
  }, [])
  const toggleLandscape = () => {
    if (forcedLandscape) {
      void ScreenOrientation.unlockAsync()
    } else {
      void ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.LANDSCAPE
      )
    }
    setForcedLandscape(!forcedLandscape)
  }

  const scale = useSharedValue(1)
  const savedScale = useSharedValue(1)
  const x = useSharedValue(0)
  const y = useSharedValue(0)
  const savedX = useSharedValue(0)
  const savedY = useSharedValue(0)
  const dismissY = useSharedValue(0)
  const touchStartX = useSharedValue(0)
  const touchStartY = useSharedValue(0)

  const reset = () => {
    "worklet"
    scale.value = withTiming(1, { duration: RESET_MS })
    x.value = withTiming(0, { duration: RESET_MS })
    y.value = withTiming(0, { duration: RESET_MS })
    savedScale.value = 1
    savedX.value = 0
    savedY.value = 0
  }
  // How far a zoomed share may move before its edge leaves the frame's edge.
  const limitX = (zoom: number) => {
    "worklet"
    return ((zoom - 1) * frame.width) / 2
  }
  const limitY = (zoom: number) => {
    "worklet"
    return ((zoom - 1) * frame.height) / 2
  }

  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = Math.min(
        Math.max(savedScale.value * event.scale, 1),
        MAX_SCALE
      )
      x.value = clamp(x.value, limitX(scale.value))
      y.value = clamp(y.value, limitY(scale.value))
    })
    .onEnd(() => {
      if (scale.value <= 1.02) reset()
      else savedScale.value = scale.value
    })
  // Moving around only while zoomed in; otherwise a drag is the dismiss.
  const pan = Gesture.Pan()
    .manualActivation(true)
    .onTouchesMove((event, manager) => {
      if (event.numberOfTouches === 1 && scale.value > 1.02) manager.activate()
      else manager.fail()
    })
    .onUpdate((event) => {
      x.value = clamp(savedX.value + event.translationX, limitX(scale.value))
      y.value = clamp(savedY.value + event.translationY, limitY(scale.value))
    })
    .onEnd(() => {
      savedX.value = x.value
      savedY.value = y.value
    })
  // Drag down to close, like the image viewer: it starts only on a mostly
  // downward drag at normal size, and the backdrop fades as the share goes.
  const dismiss = Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((event) => {
      const touch = event.allTouches[0]
      if (!touch) return
      touchStartX.value = touch.absoluteX
      touchStartY.value = touch.absoluteY
    })
    .onTouchesMove((event, manager) => {
      const touch = event.allTouches[0]
      if (!touch || event.numberOfTouches !== 1 || scale.value > 1.02) {
        manager.fail()
        return
      }
      const deltaX = touch.absoluteX - touchStartX.value
      const deltaY = touch.absoluteY - touchStartY.value
      if (deltaY > 10 && deltaY > Math.abs(deltaX) * 1.15) manager.activate()
      else if (Math.abs(deltaX) > 10 || deltaY < -8) manager.fail()
    })
    .onUpdate((event) => {
      dismissY.value = Math.max(0, event.translationY)
    })
    .onEnd((event) => {
      if (
        event.translationY > DISMISS_DISTANCE ||
        event.velocityY > DISMISS_VELOCITY
      ) {
        dismissY.value = withTiming(
          frame.height,
          { duration: DISMISS_MS },
          (finished) => {
            if (finished) scheduleOnRN(onClose)
          }
        )
        return
      }
      dismissY.value = withSpring(0, SNAP_BACK)
    })
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (savedScale.value > 1) {
        reset()
        return
      }
      scale.value = withTiming(DOUBLE_TAP_SCALE, { duration: RESET_MS })
      savedScale.value = DOUBLE_TAP_SCALE
    })
  const gesture = Gesture.Simultaneous(
    pinch,
    Gesture.Race(pan, dismiss, doubleTap)
  )
  // A turn changes the frame, so zoom starts over.
  useEffect(() => {
    reset()
  }, [frame.width, frame.height])

  const zoomStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value + dismissY.value },
      { scale: scale.value * (1 - Math.min(dismissY.value / 1800, 0.08)) },
    ],
  }))
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      dismissY.value,
      [0, frame.height * 0.4],
      [1, 0],
      Extrapolation.CLAMP
    ),
  }))
  const controlsStyle = useAnimatedStyle(() => ({
    opacity: interpolate(dismissY.value, [0, 80], [1, 0], Extrapolation.CLAMP),
  }))

  return (
    <Modal
      accessibilityViewIsModal
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      supportedOrientations={["portrait", "landscape"]}
      transparent
      visible
    >
      <StatusBar hidden={landscape} style="light" />
      <View className="flex-1 overflow-hidden">
        <Animated.View
          className="bg-neutral-950"
          style={[StyleSheet.absoluteFill, backdropStyle]}
        />
        <GestureDetector gesture={gesture}>
          <Animated.View style={[StyleSheet.absoluteFill, zoomStyle]}>
            <VideoTrack
              objectFit="contain"
              style={StyleSheet.absoluteFill}
              trackRef={trackRef}
            />
          </Animated.View>
        </GestureDetector>
        <Animated.View
          className="absolute inset-x-0 top-0 flex-row items-center gap-three"
          pointerEvents="box-none"
          style={[controlsInset, controlsStyle]}
        >
          <Text
            className="min-w-0 flex-1 text-[15px] font-semibold"
            numberOfLines={1}
            style={{ color: viewerForeground }}
          >
            {sharerName}'s screen
          </Text>
          <ViewerButton
            icon={
              forcedLandscape
                ? OrientationLandscapeToPotraitIcon
                : OrientationPotraitToLandscapeIcon
            }
            label={forcedLandscape ? "Rotate automatically" : "Landscape"}
            onPress={toggleLandscape}
          />
          <ViewerButton icon={Cancel01Icon} label="Close" onPress={onClose} />
        </Animated.View>
      </View>
    </Modal>
  )
}
