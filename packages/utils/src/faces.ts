import type { CreatureId } from "./bestiary"

// The channel agents' faces (reference/always-on-agents.md, decision 41).
// A face is a handful of solids in space: balls, limbs (a cone or capsule
// between two points) and boxes, plus two eyes on its surface. It is turned
// as a whole and projected to flat shapes (`faceFrame`), so a part behind
// another is hidden, a snout sticks out in profile, and the eyes ride round
// the head. There is no WebGL and no shading: one definition draws in the
// web app, on a phone and as a still for Discord (`faceSvg`).
//
// A face is plain JSON on purpose, so one a team makes later (decision 40)
// is one more `FaceSpec`, stored and validated, with no new drawing code. A
// short list of parts is also something a model can write from a
// description.
//
// What makes the built-in set read as one: each creature is one saturated
// colour, with a second tone only where it is what makes the creature (the
// owl's face discs); nothing is outlined or shaded; the eyes are small and
// set high.

export type V3 = [x: number, y: number, z: number]

type Paint = {
  // Where it isn't the face's own colour.
  color?: string
  // Nudges the drawing order when two parts sit at the same depth.
  lift?: number
}

// Parts are in a 24x24 box, x to the right and y down, with z toward the
// viewer and 0 at the middle of the head.
export type FacePart =
  // A ball, or an ellipsoid when `r` has three radii.
  | ({ ball: V3; r: number | V3 } & Paint)
  // From one point to another, with a radius at each end.
  | ({ limb: [V3, V3]; r: [number, number] } & Paint)
  // Its corners are rounded by the face's `soft`, so `half` is the box
  // inset by half of that.
  | ({ box: V3; half: V3 } & Paint)

export type FaceSpec = {
  color: string
  // How far a box's corners are rounded.
  soft: number
  parts: FacePart[]
  eyes: {
    at: [V3, V3]
    // Which way each eye faces: it thins as it turns away and hides once
    // it faces backward.
    normal: [V3, V3]
    size: [width: number, height: number]
    // Light bodies take dark eyes.
    dark?: boolean
    // Eyes of another colour.
    color?: string
  }
  // The angle it holds when nothing has its attention, in radians: a face
  // a little off the front looks somewhere even when still.
  rest: [yaw: number, pitch: number]
}

export const FACE_BOX = 24
export const LIGHT_EYE = "#ffffff"
export const DARK_EYE = "#16161a"

// A point on a ball's surface and the way it faces: `lon` to the side and
// `lat` up, in degrees.
function onBall(centre: V3, r: V3, lon: number, lat: number) {
  const a = (lon * Math.PI) / 180
  const b = (lat * Math.PI) / 180
  const dir: V3 = [
    Math.sin(a) * Math.cos(b),
    -Math.sin(b),
    Math.cos(a) * Math.cos(b),
  ]
  const normal: V3 = [dir[0] / r[0], dir[1] / r[1], dir[2] / r[2]]
  const length = Math.hypot(...normal)
  return {
    at: [
      centre[0] + r[0] * dir[0],
      centre[1] + r[1] * dir[1],
      centre[2] + r[2] * dir[2],
    ] as V3,
    normal: [normal[0] / length, normal[1] / length, normal[2] / length] as V3,
  }
}

// Two eyes on a ball, mirrored.
function eyesOn(centre: V3, r: V3, lon: number, lat: number) {
  const left = onBall(centre, r, -lon, lat)
  const right = onBall(centre, r, lon, lat)
  return {
    at: [left.at, right.at] as [V3, V3],
    normal: [left.normal, right.normal] as [V3, V3],
  }
}

// Parts in a ring round the head: a hem, a set of legs.
function ring<T>(
  count: number,
  offset: number,
  make: (cos: number, sin: number) => T
) {
  return Array.from({ length: count }, (_, index) => {
    const angle = ((offset + (360 / count) * index) * Math.PI) / 180
    return make(Math.cos(angle), Math.sin(angle))
  })
}

const CREAM = "#fff1df"
const PALE = "#f6e3c5"

export const FACES: Record<CreatureId, FaceSpec> = {
  // A round head with a crest swept back, and a snout with two nostrils.
  dragon: {
    color: "#10c06a",
    soft: 2,
    rest: [0.3, -0.08],
    parts: [
      { ball: [12, 13.4, 0], r: [7.2, 6.8, 6.6] },
      {
        limb: [
          [12, 8, -0.4],
          [11.4, 2.6, -1.6],
        ],
        r: [2, 0.5],
      },
      {
        limb: [
          [8.6, 9, -0.8],
          [4.6, 5.6, -2.6],
        ],
        r: [1.8, 0.5],
      },
      {
        limb: [
          [15.4, 9, -0.8],
          [18.6, 5, -2.6],
        ],
        r: [1.8, 0.5],
      },
      { ball: [12, 15.6, 4.6], r: [3.6, 2.5, 2.8] },
      { ball: [10.9, 15, 7.2], r: 0.45, color: DARK_EYE },
      { ball: [13.1, 15, 7.2], r: 0.45, color: DARK_EYE },
    ],
    eyes: {
      ...eyesOn([12, 13, 0], [7.2, 6.8, 6.6], 20, 14),
      size: [1.6, 3.5],
    },
  },
  // A wide cranium down to a small chin, two antennae, and big dark eyes.
  alien: {
    color: "#b4e61e",
    soft: 2,
    rest: [-0.28, -0.06],
    parts: [
      { ball: [12, 11.4, 0], r: [7, 6, 6.2] },
      { ball: [12, 16, 0.4], r: [4.4, 4.2, 4.2] },
      {
        limb: [
          [9.6, 6.4, 0],
          [7, 2.6, 0],
        ],
        r: [0.7, 0.7],
      },
      { ball: [7, 2.6, 0], r: 1.3 },
      {
        limb: [
          [14.4, 6.4, 0],
          [17, 2.6, 0],
        ],
        r: [0.7, 0.7],
      },
      { ball: [17, 2.6, 0], r: 1.3 },
    ],
    eyes: {
      ...eyesOn([12, 11.8, 0], [7, 6, 6.2], 22, -2),
      size: [2.6, 4.4],
      dark: true,
    },
  },
  // A round body with two tufts, a small beak, and the pale face discs that
  // make an owl: its eyes sit one in each disc.
  owl: {
    color: "#9c5f31",
    soft: 2,
    rest: [0.26, -0.06],
    parts: [
      { ball: [12, 12.8, 0], r: [7.3, 7.4, 6.4] },
      {
        limb: [
          [7.4, 7.6, 0],
          [5, 3.4, 0],
        ],
        r: [2.2, 0.5],
      },
      {
        limb: [
          [16.6, 7.6, 0],
          [19, 3.4, 0],
        ],
        r: [2.2, 0.5],
      },
      { ball: [9, 11.4, 5], r: [3.7, 3.7, 1.4], color: PALE },
      { ball: [15, 11.4, 5], r: [3.7, 3.7, 1.4], color: PALE },
      {
        limb: [
          [12, 13.8, 6],
          [12, 15.6, 7.6],
        ],
        r: [1.1, 0.3],
        color: "#f2a33a",
      },
    ],
    eyes: {
      at: [
        [9, 11.4, 6.4],
        [15, 11.4, 6.4],
      ],
      normal: [
        [-0.24, 0, 0.97],
        [0.24, 0, 0.97],
      ],
      size: [1.6, 3.5],
      dark: true,
    },
  },
  // A skull: big dark sockets for eyes, and teeth on a square jaw.
  skeleton: {
    color: "#f3eddc",
    soft: 2,
    rest: [-0.26, -0.06],
    parts: [
      { ball: [12, 10.6, 0], r: [7.2, 6.6, 6.6] },
      { box: [12, 16.8, 0.6], half: [3, 1.8, 2.6] },
      {
        limb: [
          [10.2, 16.2, 4.4],
          [10.2, 18.8, 4.4],
        ],
        r: [0.45, 0.45],
        color: DARK_EYE,
      },
      {
        limb: [
          [12, 16.2, 4.6],
          [12, 18.8, 4.6],
        ],
        r: [0.45, 0.45],
        color: DARK_EYE,
      },
      {
        limb: [
          [13.8, 16.2, 4.4],
          [13.8, 18.8, 4.4],
        ],
        r: [0.45, 0.45],
        color: DARK_EYE,
      },
    ],
    eyes: {
      ...eyesOn([12, 10.6, 0], [7.2, 6.6, 6.6], 22, -4),
      size: [2.9, 3.9],
      dark: true,
    },
  },
  // A dome on straight sides down to a wavy hem: three lobes across the
  // front. There are none at the back, since a face never turns far enough
  // to show it, and lobes there would fill the notches between these.
  ghost: {
    color: "#e9e6f4",
    soft: 2,
    rest: [0.28, -0.06],
    parts: [
      {
        limb: [
          [12, 10.6, 0],
          [12, 13, 0],
        ],
        r: [6, 6],
      },
      // Round the front, then one shorter lobe a little way round each
      // side, so a turn doesn't show a bare edge.
      ...(
        [
          [30, 18.4],
          [90, 18.4],
          [150, 18.4],
          [210, 16.8],
          [330, 16.8],
        ] as const
      ).map(([degrees, bottom]): FacePart => {
        const angle = (degrees * Math.PI) / 180
        const x = 12 + 4.1 * Math.cos(angle)
        const z = 4.1 * Math.sin(angle)
        return {
          limb: [
            [x, 13, z],
            [x, bottom, z],
          ],
          r: [1.95, 1.95],
        }
      }),
    ],
    eyes: {
      ...eyesOn([12, 10.6, 0], [6, 6, 6], 18, 4),
      size: [1.6, 3.5],
      dark: true,
    },
  },
  // A gumdrop on a wide base, with a shine on it.
  slime: {
    color: "#ff4fa0",
    soft: 2,
    rest: [-0.26, -0.06],
    parts: [
      { ball: [12, 17.2, 0], r: [8, 2.4, 7.6] },
      { ball: [12, 13.6, 0], r: [7.5, 6.6, 7.1] },
      { ball: [8.6, 10.2, 4.6], r: [1.2, 1.2, 0.5], color: "#ffa3cf" },
      { ball: [7.2, 12.4, 5], r: [0.6, 0.6, 0.3], color: "#ffa3cf" },
    ],
    eyes: {
      ...eyesOn([12, 13.6, 0], [7.6, 6.2, 7.2], 14, -4),
      size: [1.6, 3.5],
    },
  },
  // Two ears, and a pale snout that comes forward to a dark nose.
  fox: {
    color: "#ff6a14",
    soft: 2,
    rest: [0.3, -0.06],
    parts: [
      { ball: [12, 12.6, 0], r: [7.4, 6, 6.4] },
      {
        limb: [
          [7.6, 9.6, 0],
          [4.8, 3.4, 0],
        ],
        r: [2.8, 0.6],
      },
      {
        limb: [
          [16.4, 9.6, 0],
          [19.2, 3.4, 0],
        ],
        r: [2.8, 0.6],
      },
      {
        limb: [
          [12, 14.8, 4.6],
          [12, 16.4, 7.4],
        ],
        r: [2.9, 1.2],
        color: CREAM,
      },
      { ball: [12, 16.7, 8.3], r: 1, color: DARK_EYE },
    ],
    eyes: {
      ...eyesOn([12, 12.2, 0], [7.4, 6, 6.4], 20, 12),
      size: [1.6, 3.5],
    },
  },
  // A red cap over a short pale stem: the face is on the cap.
  myconid: {
    color: "#f2353f",
    soft: 2,
    rest: [-0.28, -0.06],
    parts: [
      {
        limb: [
          [12, 13, 0],
          [12, 19.4, 0],
        ],
        r: [3, 3.3],
        color: "#f4e8d6",
        lift: -1,
      },
      { ball: [12, 9.8, 0], r: [8.8, 5.4, 8.8] },
    ],
    eyes: {
      ...eyesOn([12, 9.8, 0], [8.8, 5.4, 8.8], 16, 4),
      size: [1.6, 3.5],
    },
  },
  // A robot's head: an antenna, bolts at the ears, and a dark screen on its
  // front that its eyes light up on.
  automaton: {
    color: "#2b8bff",
    soft: 2.6,
    rest: [0.3, -0.08],
    parts: [
      { box: [12, 13.8, 0], half: [5.9, 4.7, 4.6] },
      {
        limb: [
          [12, 8, 0],
          [12, 4, 0],
        ],
        r: [0.8, 0.8],
      },
      { ball: [12, 3.2, 0], r: 1.4 },
      {
        limb: [
          [4.2, 12.2, 0],
          [4.2, 15.4, 0],
        ],
        r: [1, 1],
      },
      {
        limb: [
          [19.8, 12.2, 0],
          [19.8, 15.4, 0],
        ],
        r: [1, 1],
      },
      { box: [12, 13.8, 5.6], half: [3.6, 2.2, 0.2], color: "#0b2a63" },
    ],
    eyes: {
      at: [
        [10.2, 13.8, 6.6],
        [13.8, 13.8, 6.6],
      ],
      normal: [
        [0, 0, 1],
        [0, 0, 1],
      ],
      size: [1.6, 3.5],
    },
  },
  // A dome on a ring of legs.
  kraken: {
    color: "#8e5bff",
    soft: 2,
    rest: [-0.28, -0.06],
    parts: [
      { ball: [12, 10.4, 0], r: [7, 6.4, 6.6] },
      ...ring(
        8,
        22.5,
        (cos, sin): FacePart => ({
          limb: [
            [12 + 3.8 * cos, 13.4, 3.8 * sin],
            [12 + 6.2 * cos, 19.8, 6.2 * sin],
          ],
          r: [1.8, 1.3],
        })
      ),
    ],
    eyes: {
      ...eyesOn([12, 10.4, 0], [7, 6.4, 6.6], 18, 0),
      size: [1.6, 3.5],
    },
  },
}

// One part as it is drawn, flat.
export type FaceShape = { key: number; fill: string } & (
  | {
      kind: "ellipse"
      cx: number
      cy: number
      rx: number
      ry: number
      tilt: number
    }
  | {
      kind: "limb"
      ax: number
      ay: number
      ar: number
      bx: number
      by: number
      br: number
      // The stretch between its two ends, as polygon points.
      quad: string | null
    }
  | { kind: "polygon"; points: string; soft: number }
)

export type FaceEye = {
  x: number
  y: number
  width: number
  height: number
  rx: number
  opacity: number
}

// A face at one angle: its parts back to front, then its eyes.
export type FaceFrame = {
  shapes: FaceShape[]
  eyes: FaceEye[]
  eyeFill: string
}

export type FacePose = {
  // Radians: to the side, and up or down.
  yaw: number
  pitch: number
  // 1 open, toward 0 shut (a blink).
  lids?: number
  // Asleep: the eyes are closed lines.
  shut?: boolean
}

const PIVOT: V3 = [12, 13, 0]

type Matrix = [V3, V3, V3]

// Turns to the side (yaw), then up or down (pitch).
function rotation(yaw: number, pitch: number): Matrix {
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  return [
    [cy, 0, sy],
    [sp * sy, cp, -sp * cy],
    [-cp * sy, sp, cp * cy],
  ]
}

function turn(m: Matrix, [x, y, z]: V3): V3 {
  return [
    m[0][0] * x + m[0][1] * y + m[0][2] * z,
    m[1][0] * x + m[1][1] * y + m[1][2] * z,
    m[2][0] * x + m[2][1] * y + m[2][2] * z,
  ]
}

function place(m: Matrix, point: V3): V3 {
  const [x, y, z] = turn(m, [
    point[0] - PIVOT[0],
    point[1] - PIVOT[1],
    point[2] - PIVOT[2],
  ])
  return [x + PIVOT[0], y + PIVOT[1], z]
}

// A turned ellipsoid's outline is an ellipse: its size and tilt.
function outline(m: Matrix, r: V3) {
  const d: V3 = [1 / r[0] ** 2, 1 / r[1] ** 2, 1 / r[2] ** 2]
  const a = (i: 0 | 1 | 2, j: 0 | 1 | 2) =>
    m[i][0] * m[j][0] * d[0] +
    m[i][1] * m[j][1] * d[1] +
    m[i][2] * m[j][2] * d[2]
  const zz = a(2, 2)
  const b11 = a(0, 0) - (a(0, 2) * a(0, 2)) / zz
  const b12 = a(0, 1) - (a(0, 2) * a(1, 2)) / zz
  const b22 = a(1, 1) - (a(1, 2) * a(1, 2)) / zz
  const mid = (b11 + b22) / 2
  const spread = Math.hypot((b11 - b22) / 2, b12)
  return {
    rx: 1 / Math.sqrt(mid + spread),
    ry: 1 / Math.sqrt(Math.max(1e-6, mid - spread)),
    tilt: (Math.atan2(2 * b12, b11 - b22) / 2) * (180 / Math.PI),
  }
}

type Point = [number, number]

// The outline of a set of points: a box's corners, seen from here.
function hull(points: Point[]) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: Point, a: Point, b: Point) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (list: Point[]) => {
    const out: Point[] = []
    for (const point of list) {
      while (out.length >= 2) {
        const a = out[out.length - 2]
        const b = out[out.length - 1]
        if (!a || !b || cross(a, b, point) > 0) break
        out.pop()
      }
      out.push(point)
    }
    out.pop()
    return out
  }
  return [...half(sorted), ...half(sorted.reverse())]
}

const round = (value: number) => Math.round(value * 100) / 100

// A face turned to a pose and flattened: what every renderer draws.
export function faceFrame(face: FaceSpec, pose: FacePose): FaceFrame {
  const m = rotation(pose.yaw, pose.pitch)
  const shapes = face.parts
    .map((part, key): FaceShape & { depth: number } => {
      const fill = part.color ?? face.color
      const lift = part.lift ?? 0
      if ("ball" in part) {
        const [x, y, z] = place(m, part.ball)
        const r: V3 =
          typeof part.r === "number" ? [part.r, part.r, part.r] : part.r
        const { rx, ry, tilt } = outline(m, r)
        return {
          key,
          fill,
          depth: z + lift,
          kind: "ellipse",
          cx: round(x),
          cy: round(y),
          rx: round(rx),
          ry: round(ry),
          tilt: round(tilt),
        }
      }
      if ("limb" in part) {
        const a = place(m, part.limb[0])
        const b = place(m, part.limb[1])
        const [ar, br] = part.r
        const length = Math.hypot(b[0] - a[0], b[1] - a[1])
        const along = Math.atan2(b[1] - a[1], b[0] - a[0])
        // Where the two ends' circles share a tangent line.
        const open =
          length > Math.abs(ar - br) ? Math.acos((ar - br) / length) : null
        const at = (centre: V3, radius: number, angle: number) =>
          `${round(centre[0] + radius * Math.cos(angle))},${round(centre[1] + radius * Math.sin(angle))}`
        return {
          key,
          fill,
          depth: (a[2] + b[2]) / 2 + lift,
          kind: "limb",
          ax: round(a[0]),
          ay: round(a[1]),
          ar,
          bx: round(b[0]),
          by: round(b[1]),
          br,
          quad:
            open === null
              ? null
              : [
                  at(a, ar, along + open),
                  at(b, br, along + open),
                  at(b, br, along - open),
                  at(a, ar, along - open),
                ].join(" "),
        }
      }
      const [hx, hy, hz] = part.half
      const corners: Point[] = []
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const [x, y] = place(m, [
              part.box[0] + sx * hx,
              part.box[1] + sy * hy,
              part.box[2] + sz * hz,
            ])
            corners.push([x, y])
          }
        }
      }
      return {
        key,
        fill,
        depth: place(m, part.box)[2] + lift,
        kind: "polygon",
        points: hull(corners)
          .map(([x, y]) => `${round(x)},${round(y)}`)
          .join(" "),
        soft: face.soft,
      }
    })
    .sort((a, b) => a.depth - b.depth)

  const [width, height] = face.eyes.size
  const eyes: FaceEye[] = []
  face.eyes.at.forEach((eye, index) => {
    const [x, y] = place(m, eye)
    const [nx, ny, nz] = turn(m, face.eyes.normal[index] ?? [0, 0, 1])
    if (nz <= 0.02) return
    // An eye facing away thins, as a disc on a ball does.
    const w = width * Math.sqrt(Math.max(0, 1 - nx * nx))
    const open = height * Math.sqrt(Math.max(0, 1 - ny * ny)) * (pose.lids ?? 1)
    const h = pose.shut ? 0.9 : open
    eyes.push({
      x: round(x - w / 2),
      y: round(y - h / 2 + (pose.shut ? 0.4 : 0)),
      width: round(w),
      height: round(h),
      rx: round(Math.min(w, h) / 2),
      opacity: round(Math.min(1, nz * 5)),
    })
  })
  return {
    shapes,
    eyes,
    eyeFill: face.eyes.color ?? (face.eyes.dark ? DARK_EYE : LIGHT_EYE),
  }
}

// The pose a face holds in a state when nothing moves it: at rest, or bowed
// with its eyes shut while it sleeps.
export function restPose(face: FaceSpec, asleep = false): FacePose {
  const [yaw, pitch] = face.rest
  return asleep ? { yaw: yaw * 0.6, pitch: -0.26, shut: true } : { yaw, pitch }
}

function attrs(values: Record<string, string | number | undefined>) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => ` ${name}="${value}"`)
    .join("")
}

// A face as a still SVG, at rest unless given a pose. `pad` adds room around
// the 24-unit box, for avatars a chat app crops to a circle.
export function faceSvg(
  face: FaceSpec,
  options: { size: number; pad?: number; pose?: FacePose }
) {
  const pad = options.pad ?? 0
  const box = FACE_BOX + pad * 2
  const frame = faceFrame(face, options.pose ?? restPose(face))
  const shapes = frame.shapes
    .map((shape) => {
      if (shape.kind === "ellipse") {
        const { cx, cy, rx, ry, tilt, fill } = shape
        return `<ellipse${attrs({ cx, cy, rx, ry, fill, transform: `rotate(${tilt} ${cx} ${cy})` })}/>`
      }
      if (shape.kind === "limb") {
        const { ax, ay, ar, bx, by, br, quad, fill } = shape
        return (
          `<g fill="${fill}"><circle${attrs({ cx: ax, cy: ay, r: ar })}/>` +
          `<circle${attrs({ cx: bx, cy: by, r: br })}/>` +
          `${quad ? `<polygon points="${quad}"/>` : ""}</g>`
        )
      }
      const { points, fill, soft } = shape
      return `<polygon${attrs({ points, fill, stroke: fill, "stroke-width": soft, "stroke-linejoin": "round" })}/>`
    })
    .join("")
  const eyes = frame.eyes
    .map(({ opacity, ...rect }) => `<rect${attrs({ ...rect, opacity })}/>`)
    .join("")
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${options.size}" height="${options.size}" viewBox="${-pad} ${-pad} ${box} ${box}">` +
    `${shapes}<g fill="${frame.eyeFill}">${eyes}</g></svg>`
  )
}

// Changes whenever a face's drawing does: what a cached copy of its image
// (a Discord webhook's avatar) is compared against.
export function faceKey(face: FaceSpec) {
  let hash = 2166136261
  for (const char of JSON.stringify(face)) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  }
  return (hash >>> 0).toString(36)
}
