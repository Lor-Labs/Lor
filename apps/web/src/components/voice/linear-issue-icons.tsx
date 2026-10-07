import { cn } from "@repo/ui/lib/utils"

// Linear's status and priority marks, drawn in our colour tokens.

const STATE_COLOR: Record<string, string> = {
  started: "text-warning",
  completed: "text-primary",
}

export function LinearStatusIcon({
  state,
  className,
}: {
  state: string | null
  className?: string
}) {
  const filled = (glyph: string) => (
    <>
      <circle cx="7" cy="7" r="7" fill="currentColor" />
      <path
        d={glyph}
        fill="none"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-background"
      />
    </>
  )
  const ring = (dashed: boolean) => (
    <circle
      cx="7"
      cy="7"
      r="6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeDasharray={dashed ? "1.4 1.74" : undefined}
    />
  )
  const shape =
    state === "completed" ? (
      filled("M4.2 7.2 6.1 9.1 9.8 5.2")
    ) : state === "canceled" ? (
      filled("M5 5l4 4M9 5 5 9")
    ) : state === "duplicate" ? (
      filled("M5 9 9 5")
    ) : state === "started" ? (
      <>
        {ring(false)}
        <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
      </>
    ) : (
      ring(state === "backlog" || state === "triage")
    )
  return (
    <svg
      viewBox="0 0 14 14"
      aria-hidden="true"
      className={cn(
        "size-3.5 shrink-0",
        (state && STATE_COLOR[state]) || "text-muted-foreground",
        className
      )}
    >
      {shape}
    </svg>
  )
}

// 0 none, 1 urgent, 2 high, 3 medium, 4 low.
export function LinearPriorityIcon({ priority }: { priority: number }) {
  if (priority === 1) {
    return (
      <svg
        viewBox="0 0 14 14"
        aria-hidden="true"
        className="size-3.5 text-urgent"
      >
        <rect width="14" height="14" rx="3" fill="currentColor" />
        <path
          d="M7 3.5v4.5M7 10.5v.01"
          strokeWidth="1.8"
          strokeLinecap="round"
          className="stroke-background"
        />
      </svg>
    )
  }
  if (priority === 0) {
    return (
      <svg viewBox="0 0 14 14" aria-hidden="true" className="size-3.5">
        <path
          d="M2 7h2M6 7h2M10 7h2"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  const lit = 5 - priority
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true" className="size-3.5">
      {[4, 7, 10].map((height, index) => (
        <rect
          key={height}
          x={1.5 + index * 4}
          y={12 - height}
          width="3"
          height={height}
          rx="1"
          fill="currentColor"
          opacity={index < lit ? 1 : 0.3}
        />
      ))}
    </svg>
  )
}
