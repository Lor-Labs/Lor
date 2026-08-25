import { Infinity01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { describeLoopSchedule } from "@repo/realtime-types/loops"
import { Button } from "@repo/ui/components/button"
import { cn } from "@repo/ui/lib/utils"
import { useParams } from "@tanstack/react-router"
import { useMemo } from "react"
import {
  LoopFrequencyDialog,
  useActivateLoop,
} from "@/components/loops/loop-actions"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import { type ChannelLoop, useLoopForCard } from "@/hooks/use-channel-loops"
import type { Message } from "@/lib/api-types"
import { toSearchPreviewText } from "@/lib/search-preview"

// The loop's chat presence, OpenAI-soft but Lor-signed: a borderless filled
// chip (the fill, not a stroke, is what reads "light"), our rounded-xl card
// radius instead of their full pill, and the purple ∞ + schedule leading —
// "∞ Every hour · Name". State reads from the leading segment ("Paused ·
// Name", dimmed "Completed · Name"); every detail lives one click away in
// the panel. Drafts get a Create Loop button beside the chip (activates in
// the viewer's device timezone).

export function LoopCard({ message }: { message: Message }) {
  const loop = useLoopForCard(message.channelId, message.id)

  if (!loop) {
    return (
      <div className="mt-1.5 w-fit max-w-xl rounded-xl bg-secondary/60 px-4 py-2.5">
        <p className="truncate text-muted-foreground text-sm leading-5">
          {toSearchPreviewText(message.content, message.mentions ?? [], {
            dropUnresolvedMentions: true,
          })}
        </p>
      </div>
    )
  }
  return <LoopCardBody loop={loop} />
}

function LoopCardBody({ loop }: { loop: ChannelLoop }) {
  const { workspaceSlug } = useParams({ strict: false })
  const { view, setView, isCollapsed, toggleCollapsed } = useRightSidebar()
  const isOpenPanel =
    !isCollapsed && view?.type === "loop" && view.loopId === loop.id
  const deviceTimezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    []
  )
  const timezone = loop.timezone ?? deviceTimezone
  const { activate, isPending, confirmFires, dismissConfirm } = useActivateLoop(
    loop,
    timezone
  )

  const isDraft = loop.status === "draft"
  const scheduleText = describeLoopSchedule(loop.schedule, null)
  // The leading segment carries state: the schedule while it runs,
  // "Paused"/"Completed" words otherwise.
  const lead =
    loop.status === "paused"
      ? "Paused"
      : loop.status === "completed"
        ? "Completed"
        : scheduleText
  const isLive = loop.status === "active" || isDraft

  const openPanel = () => {
    if (!workspaceSlug) return
    setView({
      type: "loop",
      workspaceSlug,
      channelId: loop.channelId,
      loopId: loop.id,
    })
    if (isCollapsed) toggleCollapsed()
  }

  return (
    <div className="mt-1.5 flex max-w-xl items-center gap-2">
      <button
        type="button"
        onClick={openPanel}
        className={cn(
          "flex min-w-0 cursor-pointer items-center gap-2 rounded-xl bg-secondary/60 px-4 py-2.5 text-sm leading-5 transition-colors hover:bg-secondary",
          isOpenPanel && "bg-secondary",
          loop.status === "completed" && "opacity-70"
        )}
      >
        <HugeiconsIcon
          icon={Infinity01Icon}
          size={15}
          className={cn(
            "shrink-0",
            isLive ? "text-primary" : "text-muted-foreground"
          )}
        />
        <span
          className={cn(
            "shrink-0 font-medium",
            isLive ? "text-primary" : "text-muted-foreground"
          )}
        >
          {lead}
        </span>
        <span className="shrink-0 text-muted-foreground/60">·</span>
        <span className="min-w-0 truncate font-medium">{loop.name}</span>
      </button>

      {isDraft && (
        <Button
          size="sm"
          className="shrink-0"
          loading={isPending}
          onClick={() => activate()}
        >
          Create Loop
        </Button>
      )}

      <LoopFrequencyDialog
        scheduleText={scheduleText}
        firesPerDay={confirmFires}
        onConfirm={() => activate({ confirm: true })}
        onDismiss={dismissConfirm}
      />
    </div>
  )
}
