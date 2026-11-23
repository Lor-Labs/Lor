import type { CreatureId, CreatureState } from "@repo/utils/bestiary"
import {
  FACE_BOX,
  FACES,
  type FacePose,
  type FaceSpec,
  faceFrame,
  restPose,
} from "@repo/utils/faces"
import { useThemeColor } from "heroui-native/hooks"
import { memo, useEffect, useMemo, useRef, useState } from "react"
import { AccessibilityInfo, View } from "react-native"
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

// The turning driver, as on web (apps/web agent-face.tsx) without a pointer:
// a face glances around now and then when idle and looks about while its
// agent works. One loop for every face, on the JS thread, since a pose is
// redrawn from the face's solids; capped at 30 frames a second and running
// only while something turns.
type Rig = {
  rest: [number, number]
  working: boolean
  // So faces that look about don't move in step.
  phase: number
  yaw: number
  pitch: number
  vy: number
  vp: number
  glance: [number, number] | null
  glanceUntil: number
  nextGlance: number
  shown: { yaw: number; pitch: number }
  show: (pose: FacePose) => void
}

const rigs = new Set<Rig>()
let raf = 0
let last = 0
let clock: ReturnType<typeof setInterval> | undefined

const STIFFNESS = 110
const DAMPING = 15
const FRAME_MS = 1000 / 30

function between(min: number, max: number) {
  return min + Math.random() * (max - min)
}

function step(rig: Rig, now: number, dt: number) {
  let target = rig.rest
  let busy = false
  if (rig.working) {
    const t = now / 1000 + rig.phase
    target = [Math.sin(t * 2.2) * 0.5, 0.08 + Math.sin(t * 1.3) * 0.08]
    busy = true
  } else if (rig.glance && now < rig.glanceUntil) {
    target = rig.glance
  } else {
    rig.glance = null
  }
  rig.vy += ((target[0] - rig.yaw) * STIFFNESS - rig.vy * DAMPING) * dt
  rig.vp += ((target[1] - rig.pitch) * STIFFNESS - rig.vp * DAMPING) * dt
  rig.yaw += rig.vy * dt
  rig.pitch += rig.vp * dt
  const moving =
    Math.abs(rig.vy) + Math.abs(rig.vp) > 0.01 ||
    Math.abs(target[0] - rig.yaw) + Math.abs(target[1] - rig.pitch) > 0.005
  if (
    Math.abs(rig.shown.yaw - rig.yaw) > 0.004 ||
    Math.abs(rig.shown.pitch - rig.pitch) > 0.004
  ) {
    rig.shown = { yaw: rig.yaw, pitch: rig.pitch }
    rig.show(rig.shown)
  }
  return busy || moving || rig.glance !== null
}

// Timed by performance.now(), the same clock the rigs' deadlines use.
function frame() {
  const now = performance.now()
  if (now - last < FRAME_MS - 2) {
    raf = requestAnimationFrame(frame)
    return
  }
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  let busy = false
  for (const rig of rigs) busy = step(rig, now, dt) || busy
  raf = busy ? requestAnimationFrame(frame) : 0
}

function wake() {
  if (raf) return
  last = performance.now()
  raf = requestAnimationFrame(frame)
}

// Glances come due on a slow clock, which wakes the frames.
function onClock() {
  const now = performance.now()
  let due = false
  for (const rig of rigs) {
    if (rig.working || now <= rig.nextGlance) continue
    rig.glance = [between(-0.55, 0.55), between(-0.2, 0.25)]
    rig.glanceUntil = now + between(800, 1_800)
    rig.nextGlance = now + between(5_000, 14_000)
    due = true
  }
  if (due) wake()
}

function addRig(rig: Rig) {
  if (rigs.size === 0) clock = setInterval(onClock, 250)
  rigs.add(rig)
  wake()
  return () => {
    rigs.delete(rig)
    if (rigs.size === 0) clearInterval(clock)
  }
}

// Where the driver has the face now; null while it holds its resting pose.
function useTurnedPose(face: FaceSpec, driven: boolean, working: boolean) {
  const [turned, setTurned] = useState<FacePose | null>(null)
  const [restYaw, restPitch] = face.rest
  useEffect(() => {
    if (!driven) return
    const now = performance.now()
    const remove = addRig({
      rest: [restYaw, restPitch],
      working,
      phase: Math.random() * 10,
      yaw: restYaw,
      pitch: restPitch,
      vy: 0,
      vp: 0,
      glance: null,
      glanceUntil: 0,
      nextGlance: now + between(3_000, 12_000),
      shown: { yaw: restYaw, pitch: restPitch },
      show: setTurned,
    })
    return () => {
      remove()
      setTurned(null)
    }
  }, [driven, working, restYaw, restPitch])
  return driven ? turned : null
}

// Reanimated's useReducedMotion reads the setting once at startup; the turn
// loop must stop as soon as Reduce Motion is switched on.
function useLiveReducedMotion() {
  const [reduced, setReduced] = useState(useReducedMotion())
  useEffect(() => {
    let live = true
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (live) setReduced(value)
    })
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduced
    )
    return () => {
      live = false
      subscription.remove()
    }
  }, [])
  return reduced
}

const POP_EASE = Easing.bezier(0.3, 0.7, 0.3, 1)

// A channel agent's face, from the same 3D definition web draws
// (@repo/utils/faces; reference/always-on-agents.md, decision 41). Unless
// `still`, it glances around and blinks when idle, looks about and bobs
// while its agent works, breathes bowed with its eyes shut while it sleeps,
// lands a change of state with a squash and stretch, and pulses its
// needs-you badge. Lists pass `still`: a row seen all day shouldn't move for
// decoration.
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
  const needsYou = state === "needs_you"
  const reduced = useLiveReducedMotion()
  const moves = !still && !reduced
  const [warning, background] = useThemeColor(["warning", "background"])
  const turned = useTurnedPose(face, moves && !asleep, working)
  const frame = useMemo(
    () => faceFrame(face, turned ?? restPose(face, asleep)),
    [face, turned, asleep]
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
  const breath = useSharedValue(0)
  const lids = useSharedValue(1)
  const squashX = useSharedValue(1)
  const squashY = useSharedValue(1)
  const alert = useSharedValue(0)
  // Faces blink out of step with each other.
  const blinkEvery = useMemo(() => 2_400 + Math.random() * 3_600, [])
  const bobs = working && moves
  const breathes = asleep && moves
  const blinks = !asleep && moves
  const pulses = needsYou && moves

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
    if (!breathes) return
    breath.value = withRepeat(
      withTiming(1, { duration: 1_600, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    )
    return () => {
      cancelAnimation(breath)
      breath.value = 0
    }
  }, [breathes, breath])

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

  useEffect(() => {
    if (!pulses) return
    alert.value = withRepeat(
      withTiming(1, { duration: 600, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    )
    return () => {
      cancelAnimation(alert)
      alert.value = 0
    }
  }, [pulses, alert])

  // The pop is for a change of state, not for arriving on screen.
  const shownState = useRef(state)
  useEffect(() => {
    if (!moves) {
      cancelAnimation(squashX)
      cancelAnimation(squashY)
      squashX.value = 1
      squashY.value = 1
    }
    if (shownState.current === state) return
    shownState.current = state
    if (!moves) return
    const to = (value: number, duration: number) =>
      withTiming(value, { duration, easing: POP_EASE })
    squashX.value = withSequence(
      to(0.86, 0),
      to(1.07, 190),
      to(0.98, 125),
      to(1, 105)
    )
    squashY.value = withSequence(
      to(1.12, 0),
      to(0.94, 190),
      to(1.02, 125),
      to(1, 105)
    )
  }, [state, moves, squashX, squashY])

  const bodyStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -bob.value * size * 0.04 },
      { scaleX: squashX.value * (1 + breath.value * 0.035) },
      { scaleY: squashY.value * (1 - breath.value * 0.025) },
    ],
  }))
  const lidStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: lids.value }],
  }))
  const alertStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + alert.value * 0.18 }],
  }))

  return (
    <View style={{ height: size, width: size }}>
      <Animated.View style={[{ transformOrigin: "50% 88%" }, bodyStyle]}>
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
      {needsYou ? (
        <Animated.View
          className="absolute rounded-full"
          style={[
            {
              backgroundColor: warning,
              borderColor: background,
              borderWidth: Math.max(1, unit * 1.2),
              bottom: 0,
              height: unit * 7.6,
              right: 0,
              width: unit * 7.6,
            },
            alertStyle,
          ]}
        />
      ) : null}
    </View>
  )
})
