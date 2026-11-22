import type { CreatureId, CreatureState } from "@repo/utils/bestiary"
import {
  FACE_BOX,
  FACES,
  type FaceSpec,
  faceFrame,
  restPose,
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
import Svg, { Circle, Ellipse, G, Polygon, Rect } from "react-native-svg"

// The eyes' own strip of the face, so a blink scales about their centre.
const EYE_STRIP = 6

// A channel agent's face, from the same 3D definition web draws
// (@repo/utils/faces; reference/always-on-agents.md, decision 41), held at
// its resting angle, or bowed with its eyes shut while it sleeps. There is
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
  const frame = useMemo(
    () => faceFrame(face, restPose(face, asleep)),
    [face, asleep]
  )
  const unit = size / FACE_BOX
  // The middle of the eyes, which a blink closes toward.
  const eyeLine =
    frame.eyes.length > 0
      ? frame.eyes.reduce((sum, eye) => sum + eye.y + eye.height / 2, 0) /
        frame.eyes.length
      : FACE_BOX / 2
  const stripTop = eyeLine - EYE_STRIP / 2

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
          {frame.shapes.map((shape) =>
            shape.kind === "ellipse" ? (
              <Ellipse
                cx={shape.cx}
                cy={shape.cy}
                fill={shape.fill}
                key={shape.key}
                origin={`${shape.cx}, ${shape.cy}`}
                rotation={shape.tilt}
                rx={shape.rx}
                ry={shape.ry}
              />
            ) : shape.kind === "limb" ? (
              <G fill={shape.fill} key={shape.key}>
                <Circle cx={shape.ax} cy={shape.ay} r={shape.ar} />
                <Circle cx={shape.bx} cy={shape.by} r={shape.br} />
                {shape.quad ? <Polygon points={shape.quad} /> : null}
              </G>
            ) : (
              <Polygon
                fill={shape.fill}
                key={shape.key}
                points={shape.points}
                stroke={shape.fill}
                strokeLinejoin="round"
                strokeWidth={shape.soft}
              />
            )
          )}
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
            <G fill={frame.eyeFill}>
              {frame.eyes.map((eye, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a face has two eyes, in order
                <Rect key={index} {...eye} />
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
