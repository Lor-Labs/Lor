import type { CreatureId } from "./bestiary"
import { DARK_EYE, FACE_BOX, LIGHT_EYE } from "./faces"

// The channel agents' faces as flat stills (reference/always-on-agents.md,
// decision 42): what a chat app shows as an avatar, Discord today and Slack
// later. The app draws the 3D faces in ./faces, but a 3D face frozen at one
// angle reads worse than a drawing made to be seen from the front: the
// kraken's back legs sit behind its front ones and its four legs become a
// row of lines. So each creature also has this hand-drawn front view, kept
// for the long run. A face with no still here (a team's own, later) falls
// back to its 3D face seen from the front.
//
// What makes the set read as one: each creature is one silhouette in one
// saturated colour, with no outline or shading; every corner is rounded by
// the same stroke; the eyes are small, light and set high, resting a
// little off-centre. A second tone is fine where it is what makes the
// creature, as on the owl's face discs.

type Paint = {
  // The shape's colour where it isn't the face's own (a second tone), or
  // "none" for a line.
  fill?: string
  // The rounding stroke: the shape's colour unless set, "none" for a hard
  // edge.
  stroke?: string
  // The face's `soft` unless set.
  strokeWidth?: number
  // How far forward on the face the shape sits. Unset, it is part of the
  // silhouette. A feature (a beak, a nose, a marking) takes a depth up to 1
  // and sits that much of the way toward where the eyes rest. Shapes with a
  // depth are drawn over those without.
  depth?: number
}

// Shapes are in a 24x24 box.
export type StillShape =
  | ({ path: string } & Paint)
  | ({ circle: [cx: number, cy: number, r: number] } & Paint)
  | ({
      rect: [x: number, y: number, width: number, height: number]
      rx?: number
    } & Paint)

export type StillSpec = {
  color: string
  // Rounds every convex corner: shapes are filled and stroked in their own
  // colour with round joins, so they are drawn inset by half of this.
  soft: number
  // Back to front.
  shapes: StillShape[]
  // Centre of the pair of eyes.
  eyes: [x: number, y: number]
  // Where the eyes rest when nothing has their attention.
  rest: [x: number, y: number]
  // Light bodies take dark eyes.
  darkEyes?: boolean
  // Eyes of another colour.
  eyeColor?: string
  // Width and height of an eye, where a face needs them bigger.
  eyeSize?: [width: number, height: number]
  // Between the two eyes' centres, where a face needs them wider apart.
  eyeGap?: number
}

const EYE_SIZE: [number, number] = [1.6, 3.5]
const EYE_GAP = 3.6

export const STILLS: Record<CreatureId, StillSpec> = {
  // A round head with a crest swept to one side.
  dragon: {
    color: "#10c06a",
    soft: 2.4,
    eyes: [12.2, 12.6],
    rest: [0.9, -0.7],
    shapes: [
      { circle: [12, 13.6, 7.2] },
      {
        path: "M12.6 7.2 10 2.6 9.2 7.7ZM8.3 8.3 3.6 6.4l2.5 4.4ZM13.7 7.3l3.6-2.9-.7 4.4Z",
      },
    ],
  },
  // An alien: a wide cranium down to a small chin, two antennae, and big
  // dark eyes.
  alien: {
    color: "#b4e61e",
    soft: 2,
    eyes: [12, 12.2],
    eyeGap: 5.6,
    eyeSize: [2.6, 4.4],
    rest: [0.5, -0.3],
    darkEyes: true,
    shapes: [
      {
        path: "M9.8 7.2 7.2 2.8M14.2 7.2l2.6-4.4",
        fill: "none",
        strokeWidth: 1.4,
      },
      { circle: [7.2, 2.8, 1], strokeWidth: 1 },
      { circle: [16.8, 2.8, 1], strokeWidth: 1 },
      {
        path: "M12 5.8c4.2 0 7 2.8 7 6.6 0 3.8-3 7-7 7.8-4-.8-7-4-7-7.8 0-3.8 2.8-6.6 7-6.6Z",
      },
    ],
  },
  // A round body with two tufts, a small beak, and the pale face discs that
  // make an owl: its eyes sit one in each disc.
  owl: {
    color: "#9c5f31",
    soft: 2.2,
    eyes: [12, 11.4],
    eyeGap: 6,
    rest: [0, 0.1],
    darkEyes: true,
    shapes: [
      {
        path: "M6.2 8.2 4.2 3.6l5.2 2.2ZM17.8 8.2l2-4.6-5.2 2.2Z",
      },
      {
        path: "M12 5c4.4 0 7.4 3.2 7.4 8 0 4.2-3 7-7.4 7s-7.4-2.8-7.4-7c0-4.8 3-8 7.4-8Z",
      },
      { circle: [9, 11.4, 3.8], fill: "#f6e3c5", stroke: "none", depth: 0.55 },
      { circle: [15, 11.4, 3.8], fill: "#f6e3c5", stroke: "none", depth: 0.55 },
      {
        path: "M11.1 14.6h1.8L12 16.3Z",
        fill: "#f2a33a",
        depth: 0.85,
        strokeWidth: 0.8,
      },
    ],
  },
  // A skull: big dark sockets for eyes, and teeth.
  skeleton: {
    color: "#f3eddc",
    soft: 2.2,
    eyes: [12, 10.6],
    eyeGap: 5.6,
    eyeSize: [2.9, 3.9],
    rest: [0.5, -0.3],
    darkEyes: true,
    shapes: [
      {
        path: "M4.8 10.6C4.8 6.4 8 4 12 4s7.2 2.4 7.2 6.6c0 2.4-1.1 4.1-2.8 5v3.8H7.6v-3.8c-1.7-.9-2.8-2.6-2.8-5Z",
      },
      {
        rect: [9.7, 17.3, 0.9, 3.2],
        rx: 0.45,
        fill: DARK_EYE,
        stroke: "none",
        depth: 0.3,
      },
      {
        rect: [11.55, 17.3, 0.9, 3.2],
        rx: 0.45,
        fill: DARK_EYE,
        stroke: "none",
        depth: 0.3,
      },
      {
        rect: [13.4, 17.3, 0.9, 3.2],
        rx: 0.45,
        fill: DARK_EYE,
        stroke: "none",
        depth: 0.3,
      },
    ],
  },
  // A dome with a zigzag hem.
  ghost: {
    color: "#e9e6f4",
    soft: 2,
    eyes: [12, 10.6],
    rest: [0.7, -0.5],
    darkEyes: true,
    shapes: [
      {
        path: "M5 12.4c0-5.2 3-8.2 7-8.2s7 3 7 8.2v7.2l-2.3-2-2.4 2-2.3-2-2.3 2-2.4-2-2.3 2Z",
      },
    ],
  },
  // A gumdrop with a shine on it.
  slime: {
    color: "#ff4fa0",
    soft: 2.4,
    eyes: [12.2, 13.4],
    rest: [0.4, -0.2],
    shapes: [
      {
        path: "M3.4 18.6C3.2 12 6.6 6.8 11.8 6.8c5.6 0 9 5.4 8.8 11.8Z",
      },
      { circle: [8, 10.8, 1.2], fill: "#ffa3cf", stroke: "none" },
      { circle: [6.7, 13.3, 0.6], fill: "#ffa3cf", stroke: "none" },
    ],
  },
  // Two ears over wide cheeks, down to a pale muzzle with a dark nose.
  fox: {
    color: "#ff6a14",
    soft: 2.4,
    eyes: [12, 11.4],
    rest: [-0.3, -0.2],
    shapes: [
      {
        path: "M4.2 3.2 10 8.6h4l5.8-5.4 1 9L12 19.4 3.2 12.2Z",
      },
      {
        path: "M8 15h8l-4 3.8Z",
        fill: "#fff1df",
        depth: 0.6,
        strokeWidth: 1.6,
      },
      { circle: [12, 18.2, 0.9], fill: DARK_EYE, stroke: "none", depth: 0.85 },
    ],
  },
  // A red cap over a short pale stem: the face is on the cap.
  myconid: {
    color: "#f2353f",
    soft: 2.2,
    eyes: [12, 9.4],
    rest: [0.6, -0.2],
    shapes: [
      { rect: [9.2, 13.4, 5.6, 6.4], fill: "#f4e8d6" },
      { path: "M3.2 13.2C3.2 7.6 7 4.2 12 4.2s8.8 3.4 8.8 9Z" },
    ],
  },
  // A robot's head: an antenna, bolts at the ears, and a dark screen its
  // eyes light up on.
  automaton: {
    color: "#2b8bff",
    soft: 2.6,
    eyes: [12, 13.8],
    rest: [0.5, -0.3],
    shapes: [
      { path: "M3.4 12v3.6M20.6 12v3.6", fill: "none", strokeWidth: 2 },
      { rect: [5.2, 8, 13.6, 11.6] },
      { path: "M12 7V3.8", fill: "none", strokeWidth: 1.8 },
      { circle: [12, 3.2, 1.2], strokeWidth: 1.4 },
      {
        rect: [6.8, 10, 10.4, 7.6],
        rx: 2.2,
        fill: "#0b2a63",
        depth: 0.35,
        stroke: "none",
      },
    ],
  },
  // A dome on four legs, the outer two splayed.
  kraken: {
    color: "#8e5bff",
    soft: 2,
    eyes: [12, 10.2],
    rest: [-0.7, -0.5],
    shapes: [
      { path: "M5 15v-3c0-4.6 3-7.6 7-7.6s7 3 7 7.6v3Z" },
      {
        path: "M6 14l-1.3 5.6M10 14v5.8M14 14v5.8M18 14l1.3 5.6",
        fill: "none",
        strokeWidth: 3,
      },
    ],
  },
}

// A face's shapes in drawing order: the silhouette, then its features.
function stillLayers(face: StillSpec) {
  return [
    ...face.shapes.filter((shape) => !shape.depth),
    ...face.shapes.filter((shape) => shape.depth),
  ]
}

// A shape's paint, with the face's defaults filled in.
// Where a shape sits when the face looks toward `gaze`: a feature moves
// its depth's share of the way, the silhouette stays.
function shapeShift(
  shape: StillShape,
  gaze: readonly [number, number]
): [number, number] {
  const depth = shape.depth ?? 0
  return [gaze[0] * depth, gaze[1] * depth]
}

function shapePaint(face: StillSpec, shape: StillShape) {
  const fill = shape.fill ?? face.color
  return {
    fill,
    stroke: shape.stroke ?? (fill === "none" ? face.color : fill),
    strokeWidth: shape.strokeWidth ?? face.soft,
  }
}

// The two eyes as rounded rects: open, or shut to a line.
function stillEyes(face: StillSpec, shut = false) {
  const [x, y] = face.eyes
  const gap = face.eyeGap ?? EYE_GAP
  const [width, height] = shut ? [2.4, 0.9] : (face.eyeSize ?? EYE_SIZE)
  const top = shut ? y + 0.4 : y - height / 2
  return {
    fill: face.eyeColor ?? (face.darkEyes ? DARK_EYE : LIGHT_EYE),
    rects: [x - gap / 2, x + gap / 2].map((centre) => ({
      x: centre - width / 2,
      y: top,
      width,
      height,
      rx: Math.min(width, height) / 2,
    })),
  }
}

function attrs(values: Record<string, string | number | undefined>) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => ` ${name}="${value}"`)
    .join("")
}

// A face as a still SVG, eyes open and at rest. `pad` adds room around the
// 24-unit box, for avatars a chat app crops to a circle, and `background`
// fills behind it, so a pale face still shows on a light chat.
export function stillSvg(
  face: StillSpec,
  options: { size: number; pad?: number; background?: string }
) {
  const pad = options.pad ?? 0
  const box = FACE_BOX + pad * 2
  const shapes = stillLayers(face)
    .map((shape) => {
      const { fill, stroke, strokeWidth } = shapePaint(face, shape)
      const [dx, dy] = shapeShift(shape, face.rest)
      const paint = attrs({
        fill,
        stroke,
        "stroke-width": strokeWidth,
        transform: shape.depth ? `translate(${dx} ${dy})` : undefined,
      })
      if ("path" in shape) return `<path d="${shape.path}"${paint}/>`
      if ("circle" in shape) {
        const [cx, cy, r] = shape.circle
        return `<circle${attrs({ cx, cy, r })}${paint}/>`
      }
      const [x, y, width, height] = shape.rect
      return `<rect${attrs({ x, y, width, height, rx: shape.rx })}${paint}/>`
    })
    .join("")
  const eyes = stillEyes(face)
  const [restX, restY] = face.rest
  const backdrop = options.background
    ? `<rect${attrs({ x: -pad, y: -pad, width: box, height: box, fill: options.background })}/>`
    : ""
  const eyeRects = eyes.rects.map((rect) => `<rect${attrs(rect)}/>`).join("")
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${options.size}" height="${options.size}" viewBox="${-pad} ${-pad} ${box} ${box}">` +
    backdrop +
    `<g stroke-linejoin="round" stroke-linecap="round">${shapes}</g>` +
    `<g fill="${eyes.fill}" transform="translate(${restX} ${restY})">${eyeRects}</g>` +
    "</svg>"
  )
}

// Changes whenever a face's drawing does: what a cached copy of its image
// (a Discord webhook's avatar) is compared against.
export function stillKey(face: StillSpec) {
  let hash = 2166136261
  for (const char of JSON.stringify(face)) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  }
  return (hash >>> 0).toString(36)
}
