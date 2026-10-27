import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { cn } from "@repo/ui/lib/utils"
import { useThreadContext } from "@/hooks/use-thread-context"

// Compact token formatting: the meter is about magnitude, not accounting.
function formatTokens(n: number): string {
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${Math.round(n / 1_000)}k`
  const millions = n / 1_000_000
  return `${millions >= 10 ? Math.round(millions) : millions.toFixed(1)}M`
}

const SEGMENT_META = [
  { key: "system", label: "System", className: "bg-primary/40" },
  { key: "tools", label: "Tools", className: "bg-primary/70" },
  { key: "messages", label: "Messages", className: "bg-primary" },
] as const

// Claude Code's own rows, in its order (Messages last, as in Pi's meter).
const CATEGORY_SHADES = [
  "bg-primary/30",
  "bg-primary/45",
  "bg-primary/60",
  "bg-primary/75",
  "bg-primary/90",
] as const

function Ring({ fraction }: { fraction: number }) {
  const radius = 6
  const circumference = 2 * Math.PI * radius
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4 shrink-0 -rotate-90"
      aria-hidden="true"
    >
      {/* --border sits ~0.28L against a ~0.22L composer in dark, so the track
          disappeared; a translucent muted-foreground reads in both themes. */}
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        strokeWidth="2.5"
        className="stroke-muted-foreground/30"
      />
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${circumference * fraction} ${circumference}`}
        className="stroke-primary transition-[stroke-dasharray] duration-500"
      />
    </svg>
  )
}

// Ring in the composer showing how full the model's context window is for this
// conversation, with the breakdown on hover. Hidden until Lor has actually
// run here — there is no context to report before that.
export function ContextMeter({
  scopeKey,
  isRunning,
}: {
  scopeKey: string | undefined
  isRunning: boolean
}) {
  const { data } = useThreadContext(scopeKey, isRunning)
  if (!data?.available) return null

  const fraction = Math.min(1, data.usedTokens / data.windowTokens)
  const percent = Math.round(fraction * 100)
  const categories = data.categories
  const segments = (
    categories
      ? categories.map((category, i) => ({
          key: category.name,
          label: category.name,
          className:
            i === categories.length - 1
              ? "bg-primary"
              : CATEGORY_SHADES[i % CATEGORY_SHADES.length],
          value: category.tokens,
        }))
      : SEGMENT_META.map((meta) => ({
          ...meta,
          value: data.segments[meta.key],
        }))
  ).filter((s) => s.value > 0)

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            // bg-accent, not bg-muted/n: the composer itself is bg-muted/40, so
            // a muted hover is the same token over itself and vanishes in
            // light mode. --accent steps the right way in both themes (see
            // globals.css) and matches the sibling ghost buttons.
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
            aria-label={`Context ${percent}% full`}
          />
        }
      >
        <Ring fraction={fraction} />
      </TooltipTrigger>
      <TooltipContent side="top" align="end" className="w-64 text-xs">
        <div className="flex flex-col gap-3 py-1.5">
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <span className="font-medium text-foreground">Context</span>
              <span className="text-muted-foreground tabular-nums">
                {percent}%
              </span>
            </div>
            <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-border">
              {segments.map((segment) => (
                <div
                  key={segment.key}
                  className={cn("h-full", segment.className)}
                  style={{
                    width: `${(segment.value / data.windowTokens) * 100}%`,
                  }}
                />
              ))}
            </div>
            <div className="flex flex-col gap-1">
              {segments.map((segment) => (
                <div
                  key={segment.key}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        segment.className
                      )}
                    />
                    {segment.label}
                  </span>
                  <span className="tabular-nums text-foreground">
                    {formatTokens(segment.value)}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between border-t pt-1.5">
              <span className="text-muted-foreground">Total</span>
              <span className="tabular-nums text-foreground">
                {formatTokens(data.usedTokens)} /{" "}
                {formatTokens(data.windowTokens)}
              </span>
            </div>
          </div>

          {data.compacted && (
            <p className="border-t pt-2 text-muted-foreground leading-relaxed">
              Compacted — {formatTokens(data.rawHistoryTokens)} of history kept
              as working notes. The full transcript is preserved.
            </p>
          )}

          {data.creditsSpent !== null && (
            <div className="flex items-center justify-between border-t pt-2">
              <span className="text-muted-foreground">Cost</span>
              <span className="tabular-nums text-foreground">
                {data.creditsSpent.toLocaleString()}{" "}
                {data.creditsSpent === 1 ? "credit" : "credits"}
              </span>
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
