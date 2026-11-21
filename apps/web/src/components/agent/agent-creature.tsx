import { cn } from "@repo/ui/lib/utils"
import {
  type CreatureId,
  type CreatureState,
  creatureById,
  EFFECTS,
  type PixelArt,
  pixelRuns,
  SPRITE_SIZE,
} from "@repo/utils/bestiary"
import { type CSSProperties, memo, useMemo } from "react"
import { AgentFace } from "@/components/agent/agent-face"

const runCache = new Map<string, ReturnType<typeof pixelRuns>>()

function runsFor(key: string, art: PixelArt) {
  let runs = runCache.get(key)
  if (!runs) {
    runs = pixelRuns(art)
    runCache.set(key, runs)
  }
  return runs
}

function Pixels({ cacheKey, art }: { cacheKey: string; art: PixelArt }) {
  return runsFor(cacheKey, art).map(({ color, d }) => (
    <path key={color} d={d} fill={color} />
  ))
}

function Effect({
  name,
  px,
  className,
  style,
}: {
  name: keyof typeof EFFECTS
  px: number
  className?: string
  style?: CSSProperties
}) {
  const art = EFFECTS[name]
  const width = art.rows[0]?.length ?? 0
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${width} ${art.rows.length}`}
      width={width * px}
      height={art.rows.length * px}
      shapeRendering="crispEdges"
      className={cn("pointer-events-none absolute", className)}
      style={style}
    >
      <Pixels cacheKey={`effect:${name}`} art={art} />
    </svg>
  )
}

type CreatureProps = {
  creature: CreatureId
  state?: CreatureState
  size?: number
  still?: boolean
  className?: string
  label?: string
}

// A channel agent's creature, animated by its real state: asleep with
// nothing to do, working while a turn runs, waiting on a person. `still`
// draws it without motion (old posts). It is drawn as a simple face
// (reference/always-on-agents.md, decision 39).
export const AgentCreature = AgentFace

// The detailed pixel-art bestiary (decision 33), no longer drawn in the app
// and kept in case it comes back. Only /prototype/faces shows it.
// Sizes that are multiples of 24 keep every sprite pixel whole.
export const PixelCreature = memo(function PixelCreature({
  creature,
  state = "idle",
  size = 48,
  still = false,
  className,
  label,
}: CreatureProps) {
  const art = creatureById(creature)
  const px = size / SPRITE_SIZE
  // Instances blink out of step with each other.
  const blinkDelay = useMemo(() => `${-Math.random() * 5}s`, [])
  const asleep = state === "asleep"
  const moving = !still
  const body = moving
    ? asleep
      ? "creature-breathe"
      : state === "working"
        ? "creature-hop"
        : undefined
    : undefined

  return (
    <span
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": true })}
      className={cn("relative inline-block shrink-0", className)}
      style={{ width: size, height: size, "--px": `${px}px` } as CSSProperties}
    >
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${SPRITE_SIZE} ${SPRITE_SIZE}`}
        width={size}
        height={size}
        shapeRendering="crispEdges"
        className={cn("block", body)}
      >
        {asleep ? (
          <Pixels
            cacheKey={`${creature}:closed`}
            art={{ palette: art.palette, rows: art.closed }}
          />
        ) : (
          <>
            <Pixels
              cacheKey={`${creature}:open`}
              art={{ palette: art.palette, rows: art.open }}
            />
            {moving && (
              <g
                className="creature-blink"
                style={{ animationDelay: blinkDelay }}
              >
                <Pixels
                  cacheKey={`${creature}:closed`}
                  art={{ palette: art.palette, rows: art.closed }}
                />
              </g>
            )}
          </>
        )}
      </svg>
      {moving && asleep && (
        <>
          <Effect
            name="z"
            px={px}
            className="creature-z"
            style={{ right: px * 1, top: px * 3 }}
          />
          <Effect
            name="z"
            px={px}
            className="creature-z"
            style={{ right: px * 1, top: px * 3, animationDelay: "-1.3s" }}
          />
        </>
      )}
      {moving && state === "working" && (
        <>
          <Effect
            name="sparkle"
            px={px}
            className="creature-twinkle"
            style={{ left: -px, top: px * 4 }}
          />
          <Effect
            name="sparkle"
            px={px}
            className="creature-twinkle"
            style={{ right: -px, top: px * 9, animationDelay: "-0.5s" }}
          />
          <Effect
            name="sparkle"
            px={px}
            className="creature-twinkle"
            style={{ right: px * 2, top: -px, animationDelay: "-0.9s" }}
          />
        </>
      )}
      {state === "needs_you" && (
        <Effect
          name="alert"
          px={px}
          className={moving ? "creature-alert" : undefined}
          style={{ right: -px * 3, top: -px * 4 }}
        />
      )}
    </span>
  )
})
