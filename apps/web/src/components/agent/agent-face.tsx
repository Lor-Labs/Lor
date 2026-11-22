import { cn } from "@repo/ui/lib/utils"
import type { CreatureId, CreatureState } from "@repo/utils/bestiary"
import {
  FACES,
  type FaceShape,
  type FaceSpec,
  faceEyes,
  shapePaint,
} from "@repo/utils/faces"
import { type CSSProperties, memo, useEffect, useRef } from "react"

// The channel agents' faces, animated (reference/always-on-agents.md,
// decision 39): a sprung gaze that follows the pointer, idle glances,
// blinks, and a state the face shows. What a face looks like is data in
// @repo/utils/faces, shared with the stills drawn for Discord. The detailed
// pixel-art set this replaced is kept, unused, in
// components/agent/agent-creature.tsx.

// How far the eyes travel toward what they look at, in the 24-unit box.
const LOOK = 1.7

// How much an eye narrows per unit of gaze as it nears the edge.
const NARROW = 0.16

// A gaze as the custom properties a face's layers read (globals.css,
// .face-*). The eyes go all the way, a feature goes its depth's share, and
// the silhouette leans after them. The eye nearer the edge narrows and the
// body thins a little, which is what makes a flat face seem to turn.
function poseVars(x: number, y: number): Record<string, string> {
  return {
    "--gx": x.toFixed(3),
    "--gy": y.toFixed(3),
    "--el": (1 + Math.min(0, x) * NARROW).toFixed(3),
    "--er": (1 - Math.max(0, x) * NARROW).toFixed(3),
    "--ey": (1 - Math.abs(y) * 0.07).toFixed(3),
    "--turn": (1 - Math.abs(x) * 0.022).toFixed(3),
  }
}

// One driver for every face on the page: a sprung gaze toward the pointer,
// idle glances, and blinks. It runs frames only while something moves.
type Rig = {
  root: HTMLElement
  art: SVGSVGElement
  lids: SVGGElement
  size: number
  rest: [number, number]
  // Looks at the pointer from anywhere (the agent is waiting on the person).
  anywhere: boolean
  x: number
  y: number
  vx: number
  vy: number
  glance: [number, number] | null
  glanceUntil: number
  nextGlance: number
  nextBlink: number
  blinkUntil: number
  blinks: number
}

const rigs = new Set<Rig>()
const pointer = { x: 0, y: 0, at: 0 }
let raf = 0
let last = 0
let clock: ReturnType<typeof setInterval> | undefined

const STIFFNESS = 150
const DAMPING = 17
// The pointer holds a face's attention this long after it stops moving.
const ATTENTION_MS = 3_500

function between(min: number, max: number) {
  return min + Math.random() * (max - min)
}

function step(rig: Rig, now: number, dt: number) {
  let target = rig.rest
  let busy = false
  if (now - pointer.at < ATTENTION_MS) {
    const box = rig.root.getBoundingClientRect()
    const dx = pointer.x - (box.left + box.width / 2)
    const dy = pointer.y - (box.top + box.height / 2)
    const distance = Math.hypot(dx, dy)
    const reach = rig.anywhere
      ? Number.POSITIVE_INFINITY
      : Math.max(rig.size * 5, 140)
    if (distance > 0 && distance < reach) {
      const pull = Math.min(1, distance / (rig.size * 0.8)) * LOOK
      target = [(dx / distance) * pull, (dy / distance) * pull]
    }
    busy = true
  } else if (rig.glance && now < rig.glanceUntil) {
    target = rig.glance
  } else {
    rig.glance = null
  }

  const ax = (target[0] - rig.x) * STIFFNESS - rig.vx * DAMPING
  const ay = (target[1] - rig.y) * STIFFNESS - rig.vy * DAMPING
  rig.vx += ax * dt
  rig.vy += ay * dt
  rig.x += rig.vx * dt
  rig.y += rig.vy * dt
  const moving =
    Math.abs(rig.vx) + Math.abs(rig.vy) > 0.02 ||
    Math.abs(target[0] - rig.x) + Math.abs(target[1] - rig.y) > 0.01

  const vars = poseVars(rig.x, rig.y)
  for (const name in vars) rig.art.style.setProperty(name, vars[name] ?? "")

  const blinking = now < rig.blinkUntil
  rig.lids.style.transform = blinking ? "scaleY(0.12)" : ""
  if (!blinking && rig.blinks > 0 && now > rig.blinkUntil + 110) {
    rig.blinks -= 1
    rig.blinkUntil = now + 110
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
      const angle = between(0, Math.PI * 2)
      rig.glance = [Math.cos(angle) * 1.2, Math.sin(angle) * 0.8]
      rig.glanceUntil = now + between(700, 1_600)
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

function Shape({ face, shape }: { face: FaceSpec; shape: FaceShape }) {
  const paint = shapePaint(face, shape)
  if ("path" in shape) return <path d={shape.path} {...paint} />
  if ("circle" in shape) {
    const [cx, cy, r] = shape.circle
    return <circle cx={cx} cy={cy} r={r} {...paint} />
  }
  const [x, y, width, height] = shape.rect
  return (
    <rect x={x} y={y} width={width} height={height} rx={shape.rx} {...paint} />
  )
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
  const [eyeX, eyeY] = face.eyes
  const asleep = state === "asleep"
  const working = state === "working"
  const rootRef = useRef<HTMLSpanElement>(null)
  const artRef = useRef<SVGSVGElement>(null)
  const lidsRef = useRef<SVGGElement>(null)
  // Awake and not scanning: the driver owns the gaze.
  const driven = !still && !asleep && !working
  // The pop is for a change of state, not for arriving on the page.
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
  }, [])
  const anywhere = state === "needs_you"
  // Where it looks until the driver takes over, and wherever it never does.
  const [restX, restY] = asleep || working ? [0, 0] : face.rest

  useEffect(() => {
    const root = rootRef.current
    const art = artRef.current
    const lids = lidsRef.current
    if (!driven || !root || !art || !lids) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const now = performance.now()
    const remove = addRig({
      root,
      art,
      lids,
      size,
      rest: [restX, restY],
      anywhere,
      x: restX,
      y: restY,
      vx: 0,
      vy: 0,
      glance: null,
      glanceUntil: 0,
      nextGlance: now + between(3_000, 12_000),
      nextBlink: now + between(800, 5_000),
      blinkUntil: 0,
      blinks: 0,
    })
    return () => {
      remove()
      lids.style.transform = ""
      const vars = poseVars(restX, restY)
      for (const name in vars) art.style.setProperty(name, vars[name] ?? "")
    }
  }, [driven, anywhere, size, restX, restY])

  const eyes = faceEyes(face, asleep)
  const silhouette = face.shapes.filter((shape) => !shape.depth)
  const features = face.shapes.filter((shape) => shape.depth)

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
        ref={artRef}
        aria-hidden="true"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className={cn(
          "block overflow-visible",
          !still && asleep && "face-breathe",
          !still && working && "face-bob"
        )}
        style={poseVars(restX, restY) as CSSProperties}
      >
        {/* A change of state lands with a small squash and stretch. */}
        <g
          key={state}
          className={cn(!still && mounted.current && "face-pop")}
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          <g className="face-body">
            {silhouette.map((shape, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a face's shapes are a fixed, ordered list
              <Shape key={index} face={face} shape={shape} />
            ))}
          </g>
          {/* The face itself, which scans as one while the agent works. */}
          <g className={cn(!still && working && "face-scan")}>
            {features.map((shape, index) => (
              <g
                // biome-ignore lint/suspicious/noArrayIndexKey: a face's shapes are a fixed, ordered list
                key={index}
                className="face-feature"
                style={{ "--d": shape.depth } as CSSProperties}
              >
                <Shape face={face} shape={shape} />
              </g>
            ))}
            <g className="face-eyes" fill={eyes.fill}>
              {/* Shut eyes have no lids to blink. */}
              <g
                ref={asleep ? undefined : lidsRef}
                className="transition-transform duration-75 ease-out"
                style={{ transformOrigin: `${eyeX}px ${eyeY}px` }}
              >
                {eyes.rects.map((rect, index) => (
                  <rect
                    key={rect.x}
                    {...rect}
                    className={index === 0 ? "face-eye-left" : "face-eye-right"}
                  />
                ))}
              </g>
            </g>
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
