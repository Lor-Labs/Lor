import {
  BubbleChatIcon,
  DiscordIcon,
  SlackIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { cn } from "@repo/ui/lib/utils"
import { motion } from "motion/react"
import type { ReactNode } from "react"
import type { Agent, Room, WorkState } from "./agents-data"

// Press feedback for anything clickable in the prototype.
export const PRESS =
  "transition-[transform,background-color,color,border-color] duration-150 ease-out active:scale-[0.98]"

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

export function AgentAvatar({
  agent,
  status = "idle",
  className,
}: {
  agent: Agent
  status?: AgentStatus
  className?: string
}) {
  return (
    <span className={cn("relative block size-9 shrink-0", className)}>
      <span
        className={cn(
          "flex size-full items-center justify-center rounded-[10px] text-[13px] font-semibold",
          status === "off"
            ? "border border-dashed border-muted-foreground/35 text-muted-foreground"
            : "bg-agent/12 text-agent"
        )}
      >
        {agent.name.charAt(0)}
      </span>
      {status === "working" && (
        <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-sidebar">
          <Spinner className="size-2.5" />
        </span>
      )}
      {status === "needs_you" && (
        <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-warning ring-2 ring-sidebar" />
      )}
    </span>
  )
}

export function LorMark({ className }: { className?: string }) {
  return <img src="/lor-mark.svg" alt="" className={cn("size-4", className)} />
}

export function RoomIcon({
  room,
  className,
}: {
  room: Room
  className?: string
}) {
  const icon =
    room.kind === "slack"
      ? SlackIcon
      : room.kind === "discord"
        ? DiscordIcon
        : BubbleChatIcon
  return (
    <HugeiconsIcon
      icon={icon}
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
