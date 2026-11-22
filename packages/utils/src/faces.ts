import type { CreatureId } from "./bestiary"

// The channel agents' faces as data (reference/always-on-agents.md, decision
// 39). One definition draws everywhere: the web app renders it as animated
// SVG, and `faceSvg` renders it as a still for Discord avatars and anywhere
// else an image is needed. A face is plain JSON on purpose, so a custom face
// a team makes later (decision 40) is one more `FaceSpec`, stored and
// validated, with no new drawing code.
//
// The rules that make the built-in set read as one: each creature is one
// silhouette in one saturated colour, with no outline or shading; every
// corner is rounded by the same stroke; the eyes are small, light and set
// high, resting a little off-centre so a face looks somewhere even when
// still. One colour is the rule, not a law: a second tone is fine where it
// is what makes the creature, as on the owl's face discs.

type Paint = {
  // The shape's colour where it isn't the face's own (a second tone), or
  // "none" for a line.
  fill?: string
  // The rounding stroke: the shape's colour unless set, "none" for a hard
  // edge.
  stroke?: string
  // The face's `soft` unless set.
  strokeWidth?: number
}

// Shapes are in a 24x24 box.
export type FaceShape =
  | ({ path: string } & Paint)
  | ({ circle: [cx: number, cy: number, r: number] } & Paint)
  | ({
      rect: [x: number, y: number, width: number, height: number]
      rx?: number
    } & Paint)

export type FaceSpec = {
  color: string
  // Rounds every convex corner: shapes are filled and stroked in their own
  // colour with round joins, so they are drawn inset by half of this.
  soft: number
  // Back to front.
  shapes: FaceShape[]
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

export const FACE_BOX = 24
export const LIGHT_EYE = "#ffffff"
export const DARK_EYE = "#16161a"
const EYE_SIZE: [number, number] = [1.6, 3.5]
const EYE_GAP = 3.6

export const FACES: Record<CreatureId, FaceSpec> = {
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
  // Front on: pointed ears, feathered wings raised behind it and a beak.
  // The wings and beak are a deeper tone of the body.
  griffin: {
    color: "#f7ab00",
    soft: 2,
    eyes: [12, 11.4],
    rest: [0.4, -0.3],
    shapes: [
      {
        path: "M8 17 2.6 15.4l1.8-2.2-3-2.4L3.6 9 1.2 5l8.2 2.4ZM16 17l5.4-1.6-1.8-2.2 3-2.4L20.4 9l2.4-4-8.2 2.4Z",
        fill: "#c97c00",
      },
      {
        path: "M8.4 8.8 8.2 5.2 11 7.4ZM15.6 8.8l.2-3.6L13 7.4Z",
      },
      { circle: [12, 13.4, 6.2] },
      {
        path: "M10.6 14h2.8L12 16.5Z",
        fill: "#c97c00",
        strokeWidth: 1,
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
      { circle: [9, 11.4, 3.8], fill: "#f6e3c5", stroke: "none" },
      { circle: [15, 11.4, 3.8], fill: "#f6e3c5", stroke: "none" },
      {
        path: "M11.1 14.6h1.8L12 16.3Z",
        fill: "#f2a33a",
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
      { rect: [9.7, 17.3, 0.9, 3.2], rx: 0.45, fill: DARK_EYE, stroke: "none" },
      {
        rect: [11.55, 17.3, 0.9, 3.2],
        rx: 0.45,
        fill: DARK_EYE,
        stroke: "none",
      },
      {
        rect: [13.4, 17.3, 0.9, 3.2],
        rx: 0.45,
        fill: DARK_EYE,
        stroke: "none",
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
        strokeWidth: 1.6,
      },
      { circle: [12, 18.2, 0.9], fill: DARK_EYE, stroke: "none" },
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

// A shape's paint, with the face's defaults filled in.
export function shapePaint(face: FaceSpec, shape: FaceShape) {
  const fill = shape.fill ?? face.color
  return {
    fill,
    stroke: shape.stroke ?? (fill === "none" ? face.color : fill),
    strokeWidth: shape.strokeWidth ?? face.soft,
  }
}

// The two eyes as rounded rects: open, or shut to a line.
export function faceEyes(face: FaceSpec, shut = false) {
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
export function faceSvg(
  face: FaceSpec,
  options: { size: number; pad?: number; background?: string }
) {
  const pad = options.pad ?? 0
  const box = FACE_BOX + pad * 2
  const shapes = face.shapes
    .map((shape) => {
      const { fill, stroke, strokeWidth } = shapePaint(face, shape)
      const paint = attrs({ fill, stroke, "stroke-width": strokeWidth })
      if ("path" in shape) return `<path d="${shape.path}"${paint}/>`
      if ("circle" in shape) {
        const [cx, cy, r] = shape.circle
        return `<circle${attrs({ cx, cy, r })}${paint}/>`
      }
      const [x, y, width, height] = shape.rect
      return `<rect${attrs({ x, y, width, height, rx: shape.rx })}${paint}/>`
    })
    .join("")
  const eyes = faceEyes(face)
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
export function faceKey(face: FaceSpec) {
  let hash = 2166136261
  for (const char of JSON.stringify(face)) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  }
  return (hash >>> 0).toString(36)
}
