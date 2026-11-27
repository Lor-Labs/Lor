import {
  ArrowUp02Icon,
  DiscordIcon,
  SlackIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { cn } from "@repo/ui/lib/utils"
import { motion } from "motion/react"
import type { ReactNode } from "react"
import { AgentFace } from "@/components/agent/agent-face"
import type { Agent, ChannelPlace, WorkState } from "./agents-data"

// Press feedback for anything clickable in the prototype.
export const PRESS =
  "transition-[transform,background-color,color,border-color] duration-150 ease-out active:scale-[0.98]"

export function SendButton({
  enabled,
  onClick,
}: {
  enabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      aria-label="Send"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full transition-[transform,background-color,color] duration-150 ease-out",
        enabled
          ? "cursor-pointer bg-foreground text-background active:scale-[0.94]"
          : "bg-foreground/[0.07] text-muted-foreground"
      )}
    >
      <HugeiconsIcon
        icon={ArrowUp02Icon}
        className="size-[18px]"
        strokeWidth={2.2}
      />
    </button>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "block size-3.5 shrink-0 rounded-full border-[1.5px] border-agent/20 border-t-agent motion-safe:animate-spin",
        className
      )}
    />
  )
}

export function StateIcon({ state }: { state: WorkState }) {
  if (state === "running") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center">
        <Spinner />
      </span>
    )
  }
  if (state === "needs_you") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-warning/15 text-[10px] font-bold text-warning-foreground">
        !
      </span>
    )
  }
  return (
    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
      <HugeiconsIcon icon={Tick02Icon} className="size-3" strokeWidth={2.5} />
    </span>
  )
}

export type AgentStatus = "idle" | "working" | "needs_you" | "off"

// The agent's face, drawn by the app's own component and moved by its state.
export function AgentAvatar({
  agent,
  status = "idle",
  size = 36,
  className,
}: {
  agent: Agent
  status?: AgentStatus
  size?: number
  className?: string
}) {
  return (
    <AgentFace
      creature={agent.creature}
      size={size}
      state={
        status === "off" ? "asleep" : status === "working" ? "working" : status
      }
      className={cn(status === "off" && "opacity-50", className)}
    />
  )
}

export function LorMark({ className }: { className?: string }) {
  return <img src="/lor-mark.svg" alt="" className={cn("size-4", className)} />
}

// Where a channel lives when it is not in Lor.
export function PlaceIcon({
  place,
  className,
}: {
  place: ChannelPlace
  className?: string
}) {
  if (place === "lor") return null
  return (
    <HugeiconsIcon
      icon={place === "slack" ? SlackIcon : DiscordIcon}
      className={cn("size-4 shrink-0", className)}
      strokeWidth={1.8}
    />
  )
}

// A segmented switch. `id` keeps the sliding pill of one switch from
// animating into another one on the same screen.
export function Segmented<T extends string>({
  id,
  value,
  items,
  onChange,
  className,
}: {
  id: string
  value: T
  items: { id: T; label: ReactNode }[]
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 rounded-lg bg-foreground/[0.05] p-0.5",
        className
      )}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          aria-pressed={value === item.id}
          className={cn(
            "relative flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] transition-colors duration-150",
            value === item.id
              ? "font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {value === item.id && (
            <motion.span
              layoutId={id}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="absolute inset-0 rounded-md bg-background shadow-sm dark:bg-foreground/10"
            />
          )}
          <span className="relative flex items-center gap-1.5">
            {item.label}
          </span>
        </button>
      ))}
    </div>
  )
}
