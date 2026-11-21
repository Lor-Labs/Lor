import { cn } from "@repo/ui/lib/utils"
import type { CreatureId, CreatureState } from "@repo/utils/bestiary"
import { memo, type ReactNode, useEffect, useRef } from "react"

// Simple faces: the default look of the channel agents' creatures
// (reference/always-on-agents.md, decision 39). The rules that make them
// read as one designed set: each creature is one silhouette in one
// saturated colour, with no outline or shading; every corner is rounded by
// the same stroke; the eyes are small, light and set high, resting a little
// off-centre so a face looks somewhere even when still. One colour is the
// rule, not a law (Jacob, 2026-11-21): a second tone is fine where it is
// what makes the creature, as on the owl's face discs. Motion is sprung,
// not tweened. The detailed pixel-art set this replaced is kept, unused, in
// components/agent/agent-creature.tsx.

type Face = {
  color: string
  // Rounds every convex corner: the silhouette is filled and stroked in its
  // own colour with round joins, so shapes are drawn inset by half of this.
  soft: number
  body: ReactNode
  // Centre of the pair of eyes, in the 24x24 box.
  eyes: [number, number]
  // Where the eyes rest when nothing has their attention.
  rest: [number, number]
  // Light bodies take dark eyes.
  darkEyes?: boolean
  // Eyes of another colour, where they glow.
  eye?: string
  // Width and height of an eye, where a face needs them bigger.
  eyeSize?: [number, number]
  // Between the two eyes' centres, where a face needs them wider apart.
  gap?: number
}

const FACES: Record<CreatureId, Face> = {
  // A round head with a crest swept to one side.
  dragon: {
    color: "#10c06a",
    soft: 2.4,
    eyes: [12.2, 12.6],
    rest: [0.9, -0.7],
    body: (
      <>
        <circle cx="12" cy="13.6" r="7.2" />
        <path d="M12.6 7.2 10 2.6 9.2 7.7ZM8.3 8.3 3.6 6.4l2.5 4.4ZM13.7 7.3l3.6-2.9-.7 4.4Z" />
      </>
    ),
  },
  // Front on, with feathered wings raised behind it and a small beak. The
  // wings and beak are a deeper tone of the body.
  griffin: {
    color: "#f7ab00",
    soft: 2,
    eyes: [12, 11.4],
    rest: [0.6, -0.5],
    body: (
      <>
        <path
          d="M7.4 16.4 3.6 13.6l1.4-1.8-2.8-2.2 1.6-1.6L2 4.6l7.6 3.8ZM16.6 16.4l3.8-2.8-1.4-1.8 2.8-2.2-1.6-1.6L22 4.6l-7.6 3.8Z"
          fill="#c97c00"
          stroke="#c97c00"
        />
        <circle cx="12" cy="13.4" r="6.4" />
        <path
          d="M10.9 14.4h2.2L12 16.3Z"
          fill="#c97c00"
          stroke="#c97c00"
          strokeWidth="1"
        />
      </>
    ),
  },
  // An upright egg with two tufts and the pale face discs that make an
  // owl: its eyes sit one in each disc.
  owl: {
    color: "#9c5f31",
    soft: 2.2,
    eyes: [12, 11.2],
    gap: 5.8,
    rest: [-0.5, -0.3],
    darkEyes: true,
    body: (
      <>
        <path d="M6.6 7.8 5.4 3.8l4.2 1.8ZM17.4 7.8l1.2-4-4.2 1.8Z" />
        <path d="M12 4.6c4.2 0 7 3.4 7 8.4 0 4.4-2.8 7.2-7 7.2s-7-2.8-7-7.2c0-5 2.8-8.4 7-8.4Z" />
        <g fill="#f6e3c5" stroke="none">
          <circle cx="9.1" cy="11.2" r="3.7" />
          <circle cx="14.9" cy="11.2" r="3.7" />
        </g>
      </>
    ),
  },
  // A skeleton (the id is still `golem`, from the creature it replaced): a skull with big dark sockets for eyes, a nose and teeth.
  golem: {
    color: "#f3eddc",
    soft: 2.2,
    eyes: [12, 10.6],
    gap: 5.6,
    eyeSize: [2.9, 3.9],
    rest: [0.5, -0.3],
    darkEyes: true,
    body: (
      <>
        <path d="M4.8 10.6C4.8 6.4 8 4 12 4s7.2 2.4 7.2 6.6c0 2.4-1.1 4.1-2.8 5v3.8H7.6v-3.8c-1.7-.9-2.8-2.6-2.8-5Z" />
        <g fill="#16161a" stroke="none">
          <path d="M12 13.3 13 15.1h-2Z" />
          <rect x="9.7" y="17.3" width=".9" height="3.2" rx=".45" />
          <rect x="11.55" y="17.3" width=".9" height="3.2" rx=".45" />
          <rect x="13.4" y="17.3" width=".9" height="3.2" rx=".45" />
        </g>
      </>
    ),
  },
  // A dome with a zigzag hem.
  ghost: {
    color: "#e9e6f4",
    soft: 2,
    eyes: [12, 10.6],
    rest: [0.7, -0.5],
    darkEyes: true,
    body: (
      <path d="M5 12.4c0-5.2 3-8.2 7-8.2s7 3 7 8.2v7.2l-2.3-2-2.4 2-2.3-2-2.3 2-2.4-2-2.3 2Z" />
    ),
  },
  // A mound pulled up into a drip.
  slime: {
    color: "#ff4fa0",
    soft: 2.2,
    eyes: [12.4, 14],
    rest: [0.5, -0.3],
    body: (
      <path d="M3.2 19c0-5.8 3.6-9 6.2-11.2 1.2-1 1.6-2.6 1.8-4.6 2 1.8 3.4 3.6 4.8 5.2 3 2.2 4.8 5.4 4.8 10.6Z" />
    ),
  },
  // Wide at the ears, down to a pointed chin.
  fox: {
    color: "#ff6a14",
    soft: 2.6,
    eyes: [12, 11.2],
    rest: [-0.7, -0.4],
    body: <path d="M4 3.4 9.4 7.6h5.2L20 3.4l.6 8.2L12 20.6 3.4 11.6Z" />,
  },
  // A red cap over a short pale stem: the face is on the cap.
  myconid: {
    color: "#f2353f",
    soft: 2.2,
    eyes: [12, 9.4],
    rest: [0.6, -0.2],
    body: (
      <>
        <rect
          x="9.2"
          y="13.4"
          width="5.6"
          height="6.4"
          fill="#f4e8d6"
          stroke="#f4e8d6"
        />
        <path d="M3.2 13.2C3.2 7.6 7 4.2 12 4.2s8.8 3.4 8.8 9Z" />
      </>
    ),
  },
  // A robot's head: an antenna, bolts at the ears, and a dark screen its
  // eyes light up on.
  automaton: {
    color: "#2b8bff",
    soft: 2.6,
    eyes: [12, 13.8],
    rest: [0.5, -0.3],
    body: (
      <>
        <path d="M3.4 12v3.6M20.6 12v3.6" fill="none" strokeWidth="2" />
        <rect x="5.2" y="8" width="13.6" height="11.6" />
        <path d="M12 7V3.8" fill="none" strokeWidth="1.8" />
        <circle cx="12" cy="3.2" r="1.2" strokeWidth="1.4" />
        <rect
          x="6.8"
          y="10"
          width="10.4"
          height="7.6"
          rx="2.2"
          fill="#0b2a63"
          stroke="none"
        />
      </>
    ),
  },
  // A dome on four legs, the outer two splayed.
  kraken: {
    color: "#8e5bff",
    soft: 2,
    eyes: [12, 10.2],
    rest: [-0.7, -0.5],
    body: (
      <>
        <path d="M5 15v-3c0-4.6 3-7.6 7-7.6s7 3 7 7.6v3Z" />
        <path
          d="M6 14l-1.3 5.6M10 14v5.8M14 14v5.8M18 14l1.3 5.6"
          fill="none"
          strokeWidth="3"
        />
      </>
    ),
  },
}

const LIGHT_EYE = "#ffffff"
const DARK_EYE = "#16161a"
const EYE_W = 1.6
const EYE_H = 3.5
// Between the two eyes' centres.
const EYE_GAP = 3.6
// How far the eyes travel toward what they look at, in the 24-unit box.
const LOOK = 1.7

// One driver for every face on the page: a sprung gaze toward the pointer,
// idle glances, and blinks. It runs frames only while something moves.
type Rig = {
  root: HTMLElement
  eyes: SVGGElement
  lids: SVGGElement
  body: SVGGElement
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

  rig.eyes.style.transform = `translate(${rig.x}px, ${rig.y}px)`
  // The body leans a little the way the eyes go, so the head seems to turn.
  rig.body.style.transform = `translate(${rig.x * 0.14}px, ${rig.y * 0.1}px) rotate(${rig.x * 1.6}deg)`

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

export const AgentFace = memo(function AgentFace({
  creature,
  state = "idle",
  size = 48,
  still = false,
  className,
  label,
}: {
  creature: CreatureId
  state?: CreatureState
  size?: number
  still?: boolean
  className?: string
  label?: string
}) {
  const face = FACES[creature]
  const [eyeX, eyeY] = face.eyes
  const gap = face.gap ?? EYE_GAP
  const [eyeW, eyeH] = face.eyeSize ?? [EYE_W, EYE_H]
  const asleep = state === "asleep"
  const working = state === "working"
  const rootRef = useRef<HTMLSpanElement>(null)
  const eyesRef = useRef<SVGGElement>(null)
  const lidsRef = useRef<SVGGElement>(null)
  const bodyRef = useRef<SVGGElement>(null)
  // Awake and not scanning: the driver owns the eyes.
  const driven = !still && !asleep && !working
  // The pop is for a change of state, not for arriving on the page.
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
  }, [])
  const anywhere = state === "needs_you"
  const [restX, restY] = face.rest

  useEffect(() => {
    const root = rootRef.current
    const eyes = eyesRef.current
    const lids = lidsRef.current
    const body = bodyRef.current
    if (!driven || !root || !eyes || !lids || !body) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const now = performance.now()
    const remove = addRig({
      root,
      eyes,
      lids,
      body,
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
      eyes.style.transform = ""
      lids.style.transform = ""
      body.style.transform = ""
    }
  }, [driven, anywhere, size, restX, restY])

  const eyeFill = face.eye ?? (face.darkEyes ? DARK_EYE : LIGHT_EYE)
  // Until the driver takes over, and wherever it never does.
  const atRest =
    asleep || working ? undefined : `translate(${restX}px, ${restY}px)`

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
        <g key={state} className={cn(!still && mounted.current && "face-pop")}>
          <g
            ref={bodyRef}
            fill={face.color}
            stroke={face.color}
            strokeWidth={face.soft}
            strokeLinejoin="round"
            strokeLinecap="round"
            style={{ transformOrigin: "12px 13px" }}
          >
            {face.body}
          </g>
          <g ref={eyesRef} fill={eyeFill} style={{ transform: atRest }}>
            <g className={cn(!still && working && "face-scan")}>
              {asleep ? (
                <>
                  <rect
                    x={eyeX - gap / 2 - 1.2}
                    y={eyeY + 0.4}
                    width="2.4"
                    height=".9"
                    rx=".45"
                  />
                  <rect
                    x={eyeX + gap / 2 - 1.2}
                    y={eyeY + 0.4}
                    width="2.4"
                    height=".9"
                    rx=".45"
                  />
                </>
              ) : (
                <g
                  ref={lidsRef}
                  className="transition-transform duration-75 ease-out"
                  style={{ transformOrigin: `${eyeX}px ${eyeY}px` }}
                >
                  <rect
                    x={eyeX - gap / 2 - eyeW / 2}
                    y={eyeY - eyeH / 2}
                    width={eyeW}
                    height={eyeH}
                    rx={eyeW / 2}
                  />
                  <rect
                    x={eyeX + gap / 2 - eyeW / 2}
                    y={eyeY - eyeH / 2}
                    width={eyeW}
                    height={eyeH}
                    rx={eyeW / 2}
                  />
                </g>
              )}
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
