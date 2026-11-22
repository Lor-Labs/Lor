import type { CreatureId, CreatureState } from "@repo/utils/bestiary"
import {
  FACE_BOX,
  FACES,
  type FaceShape,
  type FaceSpec,
  faceEyes,
  faceLayers,
  shapePaint,
  shapeShift,
} from "@repo/utils/faces"
import { useThemeColor } from "heroui-native/hooks"
import { memo, useEffect, useMemo } from "react"
import { View } from "react-native"
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated"
import Svg, { Circle, G, Path, Rect } from "react-native-svg"

function Shape({ face, shape }: { face: FaceSpec; shape: FaceShape }) {
  const paint = shapePaint(face, shape)
  if ("path" in shape) return <Path d={shape.path} {...paint} />
  if ("circle" in shape) {
    const [cx, cy, r] = shape.circle
    return <Circle cx={cx} cy={cy} r={r} {...paint} />
  }
  const [x, y, width, height] = shape.rect
  return (
    <Rect height={height} rx={shape.rx} width={width} x={x} y={y} {...paint} />
  )
}

// The eyes' own strip of the face, so a blink scales about their centre.
const EYE_STRIP = 6

// A channel agent's face, from the same data web draws
// (@repo/utils/faces; reference/always-on-agents.md, decision 39). There is
// no pointer to follow on a phone, so motion only shows state: it bobs
// while the agent works, and blinks when awake and not `still`. Lists pass
// `still`: a row seen all day shouldn't move for decoration.
export const AgentCreature = memo(function AgentCreature({
  creature,
  face: custom,
  state = "idle",
  size,
  still = false,
}: {
  creature: CreatureId
  // A face that isn't one of the built-in creatures' (a team's own, later).
  face?: FaceSpec
  state?: CreatureState
  size: number
  still?: boolean
}) {
  const face = custom ?? FACES[creature]
  const asleep = state === "asleep"
  const working = state === "working"
  const reduced = useReducedMotion()
  const [warning, background] = useThemeColor(["warning", "background"])
  const eyes = faceEyes(face, asleep)
  const [restX, restY] = asleep || working ? [0, 0] : face.rest
  const unit = size / FACE_BOX
  const stripTop = face.eyes[1] - EYE_STRIP / 2

  const bob = useSharedValue(0)
  const lids = useSharedValue(1)
  // Faces blink out of step with each other.
  const blinkEvery = useMemo(() => 2_400 + Math.random() * 3_600, [])
  const bobs = working && !reduced
  const blinks = !still && !asleep && !working && !reduced

  useEffect(() => {
    if (!bobs) return
    bob.value = withRepeat(
      withTiming(1, { duration: 450, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    )
    return () => {
      cancelAnimation(bob)
      bob.value = 0
    }
  }, [bobs, bob])

  useEffect(() => {
    if (!blinks) return
    lids.value = withRepeat(
      withSequence(
        withDelay(blinkEvery, withTiming(0.12, { duration: 70 })),
        withTiming(1, { duration: 110 })
      ),
      -1
    )
    return () => {
      cancelAnimation(lids)
      lids.value = 1
    }
  }, [blinks, blinkEvery, lids])

  const bodyStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -bob.value * size * 0.05 }],
  }))
  const lidStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: lids.value }],
  }))

  return (
    <View style={{ height: size, width: size }}>
      <Animated.View style={bodyStyle}>
        <Svg height={size} viewBox={`0 0 ${FACE_BOX} ${FACE_BOX}`} width={size}>
          <G strokeLinecap="round" strokeLinejoin="round">
            {faceLayers(face).map((shape, index) => {
              // A feature sits where the resting gaze puts it, as on web.
              const [dx, dy] = shapeShift(shape, [restX, restY])
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: a face's shapes are a fixed, ordered list
                <G key={index} translateX={dx} translateY={dy}>
                  <Shape face={face} shape={shape} />
                </G>
              )
            })}
          </G>
        </Svg>
        <Animated.View
          pointerEvents="none"
          style={[
            {
              height: EYE_STRIP * unit,
              left: 0,
              position: "absolute",
              top: stripTop * unit,
              width: size,
            },
            lidStyle,
          ]}
        >
          <Svg
            height={EYE_STRIP * unit}
            viewBox={`0 ${stripTop} ${FACE_BOX} ${EYE_STRIP}`}
            width={size}
          >
            <G fill={eyes.fill} translateX={restX} translateY={restY}>
              {eyes.rects.map((rect) => (
                <Rect key={rect.x} {...rect} />
              ))}
            </G>
          </Svg>
        </Animated.View>
      </Animated.View>
      {state === "needs_you" ? (
        <View
          className="absolute rounded-full"
          style={{
            backgroundColor: warning,
            borderColor: background,
            borderWidth: Math.max(1, unit * 1.2),
            bottom: 0,
            height: unit * 7.6,
            right: 0,
            width: unit * 7.6,
          }}
        />
      ) : null}
    </View>
  )
})
