import { useCallback, useMemo } from "react"
import { Image, type LayoutChangeEvent, View } from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withSpring,
} from "react-native-reanimated"
import { scheduleOnRN } from "react-native-worklets"

const MAX_SCALE = 5
const DOUBLE_TAP_SCALE = 2.5
const springConfig = { damping: 22, stiffness: 220 }

// Pinch-to-zoom image: pinch around the fingers, double-tap to zoom in/out,
// one-finger pan while zoomed. Panning is bounded by the fitted image, not
// its letterboxing. `onZoomChange` lets a modal sheet turn off swipe-to-dismiss.
export function ZoomableImage({
  uri,
  accessibilityLabel,
  onZoomChange,
}: {
  uri: string
  accessibilityLabel?: string
  onZoomChange?: (zoomed: boolean) => void
}) {
  const boxW = useSharedValue(0)
  const boxH = useSharedValue(0)
  const aspect = useSharedValue(0)
  const scale = useSharedValue(1)
  const savedScale = useSharedValue(1)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const pinchContentX = useSharedValue(0)
  const pinchContentY = useSharedValue(0)
  const panBaseX = useSharedValue(0)
  const panBaseY = useSharedValue(0)
  const pinching = useSharedValue(false)

  const notifyZoom = useCallback(
    (zoomed: boolean) => onZoomChange?.(zoomed),
    [onZoomChange]
  )

  const gesture = useMemo(() => {
    const bounds = (s: number) => {
      "worklet"
      let fitW = boxW.value
      let fitH = boxH.value
      if (aspect.value > 0 && fitW > 0 && fitH > 0) {
        if (fitW / fitH > aspect.value) fitW = fitH * aspect.value
        else fitH = fitW / aspect.value
      }
      return {
        x: Math.max(0, (fitW * s - boxW.value) / 2),
        y: Math.max(0, (fitH * s - boxH.value) / 2),
      }
    }
    const clamp = (value: number, max: number) => {
      "worklet"
      return Math.min(Math.max(value, -max), max)
    }
    const reset = () => {
      "worklet"
      scale.value = withSpring(1, springConfig)
      tx.value = withSpring(0, springConfig)
      ty.value = withSpring(0, springConfig)
      savedScale.value = 1
      scheduleOnRN(notifyZoom, false)
    }
    const zoomTo = (s: number, nextX: number, nextY: number) => {
      "worklet"
      const max = bounds(s)
      scale.value = withSpring(s, springConfig)
      tx.value = withSpring(clamp(nextX, max.x), springConfig)
      ty.value = withSpring(clamp(nextY, max.y), springConfig)
      savedScale.value = s
      scheduleOnRN(notifyZoom, true)
    }

    const pinch = Gesture.Pinch()
      .onStart((event) => {
        pinching.value = true
        savedScale.value = scale.value
        const fx = event.focalX - boxW.value / 2
        const fy = event.focalY - boxH.value / 2
        pinchContentX.value = (fx - tx.value) / scale.value
        pinchContentY.value = (fy - ty.value) / scale.value
      })
      .onUpdate((event) => {
        const s = Math.min(
          Math.max(savedScale.value * event.scale, 0.8),
          MAX_SCALE * 1.2
        )
        scale.value = s
        tx.value = event.focalX - boxW.value / 2 - pinchContentX.value * s
        ty.value = event.focalY - boxH.value / 2 - pinchContentY.value * s
      })
      .onEnd(() => {
        if (scale.value <= 1.02) {
          reset()
          return
        }
        zoomTo(Math.min(scale.value, MAX_SCALE), tx.value, ty.value)
      })
      .onFinalize(() => {
        pinching.value = false
      })

    const pan = Gesture.Pan()
      .manualActivation(true)
      .onTouchesMove((event, manager) => {
        if (event.numberOfTouches === 1 && scale.value > 1.02) {
          manager.activate()
        } else if (event.numberOfTouches === 1) {
          manager.fail()
        }
      })
      .onStart(() => {
        panBaseX.value = tx.value
        panBaseY.value = ty.value
      })
      .onUpdate((event) => {
        // While a pinch drives the transform, keep the base in step so the
        // pan picks up from there without a jump.
        if (pinching.value) {
          panBaseX.value = tx.value - event.translationX
          panBaseY.value = ty.value - event.translationY
          return
        }
        // savedScale is the scale a pinch spring is settling to.
        const max = bounds(savedScale.value)
        tx.value = clamp(panBaseX.value + event.translationX, max.x)
        ty.value = clamp(panBaseY.value + event.translationY, max.y)
      })
      .onEnd((event) => {
        if (pinching.value) return
        const max = bounds(savedScale.value)
        tx.value = withDecay({
          velocity: event.velocityX,
          clamp: [-max.x, max.x],
        })
        ty.value = withDecay({
          velocity: event.velocityY,
          clamp: [-max.y, max.y],
        })
      })

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDuration(260)
      .onEnd((event, success) => {
        if (!success) return
        if (scale.value > 1.02) {
          reset()
          return
        }
        const px = event.x - boxW.value / 2
        const py = event.y - boxH.value / 2
        zoomTo(
          DOUBLE_TAP_SCALE,
          px - px * DOUBLE_TAP_SCALE,
          py - py * DOUBLE_TAP_SCALE
        )
      })

    return Gesture.Simultaneous(pinch, pan, doubleTap)
  }, [
    aspect,
    boxH,
    boxW,
    notifyZoom,
    panBaseX,
    panBaseY,
    pinchContentX,
    pinchContentY,
    pinching,
    savedScale,
    scale,
    tx,
    ty,
  ])

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }))

  // A new size (rotation) or a newly loaded aspect changes the pan bounds:
  // drop the zoom rather than leave the image outside them.
  const resetTransform = () => {
    scale.value = 1
    savedScale.value = 1
    tx.value = 0
    ty.value = 0
    notifyZoom(false)
  }

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    if (width === boxW.value && height === boxH.value) return
    boxW.value = width
    boxH.value = height
    resetTransform()
  }

  return (
    <GestureDetector gesture={gesture}>
      <View
        className="flex-1 overflow-hidden"
        collapsable={false}
        onLayout={onLayout}
      >
        <Animated.View className="flex-1" style={animatedStyle}>
          <Image
            accessibilityHint="Pinch or double-tap to zoom"
            accessibilityLabel={accessibilityLabel}
            onLoad={(event) => {
              const { width, height } = event.nativeEvent.source
              if (width > 0 && height > 0 && width / height !== aspect.value) {
                aspect.value = width / height
                resetTransform()
              }
            }}
            resizeMode="contain"
            source={{ uri }}
            style={{ flex: 1 }}
          />
        </Animated.View>
      </View>
    </GestureDetector>
  )
}
