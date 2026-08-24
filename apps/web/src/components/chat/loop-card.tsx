import { Infinity01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { describeLoopSchedule } from "@repo/realtime-types/loops"
import { Badge } from "@repo/ui/components/badge"
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
import { LOOP_STATUS_META } from "@/lib/loop-ui"
import { toSearchPreviewText } from "@/lib/search-preview"

// Compact loop pill (ChatGPT-scheduled-tasks inspired): icon, name, and the
// plain-english schedule — nothing else. Clicking opens the loop detail
// panel where the full prompt, timezone, and next-run info live. Drafts get
// a quick Create Loop button that activates in the viewer's device timezone;
// picking a different one happens in the panel.
const SURFACE_CLASS =
  "relative mt-1.5 w-full max-w-xl overflow-hidden rounded-xl border bg-card transition-colors"

export function LoopCard({ message }: { message: Message }) {
  const loop = useLoopForCard(message.channelId, message.id)

  if (!loop) {
    return (
      <div className={SURFACE_CLASS}>
        <p className="line-clamp-2 px-4 py-3.5 text-muted-foreground text-sm leading-5">
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

  const meta = LOOP_STATUS_META[loop.status]
  const isDraft = loop.status === "draft"
  // Timezone stays out of the card — the panel owns it.
  const scheduleText = describeLoopSchedule(loop.schedule, null)

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
    <div
      className={cn(
        "group/loop",
        SURFACE_CLASS,
        isOpenPanel ? "border-foreground/25" : "hover:bg-muted/30"
      )}
    >
      <button
        type="button"
        aria-label="Open loop details"
        onClick={openPanel}
        className="absolute inset-0 z-10 cursor-pointer rounded-xl"
      />
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground ring-1 ring-border/40 ring-inset">
          <HugeiconsIcon icon={Infinity01Icon} size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-sm leading-5">{loop.name}</p>
          <p className="truncate text-muted-foreground text-sm leading-5">
            {scheduleText}
          </p>
        </div>
        {isDraft ? (
          <Button
            size="sm"
            className="relative z-20 shrink-0"
            loading={isPending}
            onClick={() => activate()}
          >
            Create Loop
          </Button>
        ) : (
          <Badge variant={meta.badgeVariant} size="sm" className="shrink-0">
            <HugeiconsIcon icon={meta.icon} size={12} />
            {meta.label}
          </Badge>
        )}
      </div>

      <LoopFrequencyDialog
        scheduleText={scheduleText}
        firesPerDay={confirmFires}
        onConfirm={() => activate({ confirm: true })}
        onDismiss={dismissConfirm}
      />
    </div>
  )
}
