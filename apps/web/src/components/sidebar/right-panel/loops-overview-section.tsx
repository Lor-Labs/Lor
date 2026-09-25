import { ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { LoopRow, sortLoops } from "@/components/loops/loop-row"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import { useChannelLoops } from "@/hooks/use-channel-loops"

// Completed loops remain available through the full list.
const OVERVIEW_LOOP_COUNT = 3

export function LoopsOverviewSection({
  workspaceSlug,
  channelId,
}: {
  workspaceSlug: string
  channelId: string
}) {
  const { setView } = useRightSidebar()
  const { data } = useChannelLoops(channelId)
  const loops = sortLoops(
    (data ?? []).filter((loop) => loop.status !== "completed")
  )

  const visible = loops.slice(0, OVERVIEW_LOOP_COUNT)
  const hiddenCount = loops.length - visible.length

  const openAll = () => setView({ type: "loops", workspaceSlug, channelId })
  if (!loops.length) return null

  return (
    <section className="border-t border-border/60 pt-3">
      <div className="flex items-center justify-between pb-1 pl-1">
        <span className="font-medium text-xs text-muted-foreground">
          Loops{loops.length ? ` · ${loops.length}` : ""}
        </span>
        <button
          type="button"
          aria-label="View all loops"
          onClick={openAll}
          className="flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
        </button>
      </div>
      <div className="space-y-0.5">
        {visible.map((loop) => (
          <LoopRow
            key={loop.id}
            loop={loop}
            onOpen={() =>
              setView({
                type: "loop",
                workspaceSlug,
                channelId,
                loopId: loop.id,
              })
            }
          />
        ))}
      </div>
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={openAll}
          className="mt-0.5 w-full cursor-pointer rounded-lg px-2 py-1.5 text-left text-muted-foreground text-xs transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
        >
          Show {hiddenCount} more…
        </button>
      )}
    </section>
  )
}
