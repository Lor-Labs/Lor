import { cn } from "@repo/ui/lib/utils"
import type { CreatureId, CreatureState } from "@repo/utils/bestiary"
import {
  FACES,
  type FacePose,
  type FaceSpec,
  faceFrame,
  restPose,
} from "@repo/utils/faces"
import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react"

// The channel agents' faces, alive (reference/always-on-agents.md, decision
// 41). A face is 3D: solids defined in @repo/utils/faces, turned in space
// and drawn flat. Here it turns toward the pointer on a spring, glances
// around and blinks when idle, looks about while its agent works, and bows
// its head to sleep. The same definition draws the stills for Discord. The
// detailed pixel-art set this replaced is kept, unused, in
// components/agent/agent-creature.tsx.

// How far a face turns toward what it looks at, in radians.
const TURN = 0.8
const TILT = 0.45

// One driver for every face on the page. It runs frames only while
// something moves.
type Rig = {
  root: HTMLElement
  size: number
  rest: [number, number]
  // Looks at the pointer from anywhere (the agent is waiting on the person).
  anywhere: boolean
  // Looks about on its own (the agent is working).
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
  nextBlink: number
  blinkUntil: number
  blinks: number
  shown: { yaw: number; pitch: number; lids: number }
  show: (pose: FacePose) => void
}

const rigs = new Set<Rig>()
const pointer = { x: 0, y: 0, at: Number.NEGATIVE_INFINITY }
let raf = 0
let last = 0
let clock: ReturnType<typeof setInterval> | undefined

const STIFFNESS = 110
const DAMPING = 15
// The pointer holds a face's attention this long after it stops moving.
const ATTENTION_MS = 3_500

function between(min: number, max: number) {
  return min + Math.random() * (max - min)
}

function clamp(value: number) {
  return Math.max(-1, Math.min(1, value))
}

function step(rig: Rig, now: number, dt: number) {
  let target = rig.rest
  let busy = false
  if (rig.working) {
    const t = now / 1000 + rig.phase
    target = [Math.sin(t * 2.2) * 0.5, 0.08 + Math.sin(t * 1.3) * 0.08]
    busy = true
  } else if (now - pointer.at < ATTENTION_MS) {
    const box = rig.root.getBoundingClientRect()
    const dx = pointer.x - (box.left + box.width / 2)
    const dy = pointer.y - (box.top + box.height / 2)
    const reach = rig.anywhere
      ? Number.POSITIVE_INFINITY
      : Math.max(rig.size * 5, 140)
    if (Math.hypot(dx, dy) < reach) {
      // A pointer this far to the side has it fully turned. One that waits
      // on the person looks across the page, so it turns more gradually.
      const full = rig.anywhere ? 320 : Math.max(rig.size * 2.2, 60)
      target = [clamp(dx / full) * TURN, -clamp(dy / full) * TILT]
    }
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

  const blinking = now < rig.blinkUntil
  if (!blinking && rig.blinks > 0 && now > rig.blinkUntil + 110) {
    rig.blinks -= 1
    rig.blinkUntil = now + 110
  }
  const lids = blinking ? 0.12 : 1
  const { shown } = rig
  if (
    Math.abs(shown.yaw - rig.yaw) > 0.004 ||
    Math.abs(shown.pitch - rig.pitch) > 0.004 ||
    shown.lids !== lids
  ) {
    rig.shown = { yaw: rig.yaw, pitch: rig.pitch, lids }
    rig.show(rig.shown)
  }
  return busy || moving || blinking || rig.blinks > 0 || rig.glance !== null
}

function frame(now: number) {
  const dt = Math.min(0.032, (now - last) / 1000)
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

function onPointerMove(event: PointerEvent) {
  pointer.x = event.clientX
  pointer.y = event.clientY
  pointer.at = performance.now()
  wake()
}

// Blinks and glances come due on a slow clock, which wakes the frames.
function onClock() {
  const now = performance.now()
  let due = false
  for (const rig of rigs) {
    if (now > rig.nextBlink) {
      rig.blinkUntil = now + 110
      // Now and then a double blink.
      rig.blinks = Math.random() < 0.18 ? 1 : 0
      rig.nextBlink = now + between(2_400, 6_500)
      due = true
    }
    if (now > rig.nextGlance) {
      rig.glance = [between(-0.55, 0.55), between(-0.2, 0.25)]
      rig.glanceUntil = now + between(800, 1_800)
      rig.nextGlance = now + between(5_000, 14_000)
      due = true
    }
  }
  if (due) wake()
}

function addRig(rig: Rig) {
  if (rigs.size === 0) {
    window.addEventListener("pointermove", onPointerMove, { passive: true })
    clock = setInterval(onClock, 250)
  }
  rigs.add(rig)
  wake()
  return () => {
    rigs.delete(rig)
    if (rigs.size === 0) {
      window.removeEventListener("pointermove", onPointerMove)
      clearInterval(clock)
    }
  }
}

// Reduced motion, followed while the page is open: a face stops turning
// when the preference is switched on, not only on the next load.
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)"

function onReducedMotionChange(notify: () => void) {
  const query = window.matchMedia(REDUCED_MOTION)
  query.addEventListener("change", notify)
  return () => query.removeEventListener("change", notify)
}

function prefersReducedMotion() {
  return window.matchMedia(REDUCED_MOTION).matches
}

export const AgentFace = memo(function AgentFace({
  creature,
  face: custom,
  state = "idle",
  size = 48,
  still = false,
  className,
  label,
}: {
  creature: CreatureId
  // A face that isn't one of the built-in creatures' (a team's own, later).
  face?: FaceSpec
  state?: CreatureState
  size?: number
  still?: boolean
  className?: string
  label?: string
}) {
  const face = custom ?? FACES[creature]
  const asleep = state === "asleep"
  const working = state === "working"
  const anywhere = state === "needs_you"
  const rootRef = useRef<HTMLSpanElement>(null)
  const reduced = useSyncExternalStore(
    onReducedMotionChange,
    prefersReducedMotion
  )
  // Asleep it holds its bowed pose; otherwise the driver turns it.
  const driven = !still && !asleep && !reduced
  // The pop is for a change of state, not for arriving on the page or a
  // pose update.
  const [shownState, setShownState] = useState(state)
  const [popped, setPopped] = useState(false)
  if (shownState !== state) {
    setShownState(state)
    setPopped(true)
  }
  const [restYaw, restPitch] = face.rest
  // Where the driver has it now; null while it holds its resting pose.
  const [turned, setTurned] = useState<FacePose | null>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!driven || !root) return
    const now = performance.now()
    const remove = addRig({
      root,
      size,
      rest: [restYaw, restPitch],
      anywhere,
      working,
      phase: Math.random() * 10,
      yaw: restYaw,
      pitch: restPitch,
      vy: 0,
      vp: 0,
      glance: null,
      glanceUntil: 0,
      nextGlance: now + between(3_000, 12_000),
      nextBlink: now + between(800, 5_000),
      blinkUntil: 0,
      blinks: 0,
      shown: { yaw: restYaw, pitch: restPitch, lids: 1 },
      show: setTurned,
    })
    return () => {
      remove()
      setTurned(null)
    }
  }, [driven, anywhere, working, size, restYaw, restPitch])

  const { shapes, eyes, eyeFill } = faceFrame(
    face,
    (driven && turned) || restPose(face, asleep)
  )

  return (
    <span
      ref={rootRef}
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": true })}
      className={cn("relative inline-block shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className={cn(
          "block overflow-visible",
          !still && asleep && "face-breathe",
          !still && working && "face-bob"
        )}
      >
        {/* A change of state lands with a small squash and stretch. */}
        <g key={state} className={cn(!still && popped && "face-pop")}>
          {shapes.map((shape) =>
            shape.kind === "ellipse" ? (
              <ellipse
                key={shape.key}
                cx={shape.cx}
                cy={shape.cy}
                rx={shape.rx}
                ry={shape.ry}
                transform={`rotate(${shape.tilt} ${shape.cx} ${shape.cy})`}
                fill={shape.fill}
              />
            ) : shape.kind === "limb" ? (
              <g key={shape.key} fill={shape.fill}>
                <circle cx={shape.ax} cy={shape.ay} r={shape.ar} />
                <circle cx={shape.bx} cy={shape.by} r={shape.br} />
                {shape.quad && <polygon points={shape.quad} />}
              </g>
            ) : (
              <polygon
                key={shape.key}
                points={shape.points}
                fill={shape.fill}
                stroke={shape.fill}
                strokeWidth={shape.soft}
                strokeLinejoin="round"
              />
            )
          )}
          <g fill={eyeFill}>
            {eyes.map((eye, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a face has two eyes, in order
              <rect key={index} {...eye} />
            ))}
          </g>
        </g>
        {state === "needs_you" && (
          <circle
            cx="19.6"
            cy="19.6"
            r="3.2"
            className={cn(
              "fill-warning stroke-background",
              !still && "face-alert"
            )}
            strokeWidth="1.4"
          />
        )}
      </svg>
    </span>
  )
})
