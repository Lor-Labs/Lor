import { LoopRow, sortLoops } from "@/components/loops/loop-row"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import { useChannelLoops } from "@/hooks/use-channel-loops"

// Discord-style section at the top of the channel overview (members) panel:
// the first few loops, with "Show more" opening the full loops list panel.
// Hidden entirely when the channel has no loops.
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
  const loops = sortLoops(data ?? [])
  if (loops.length === 0) return null

  const visible = loops.slice(0, OVERVIEW_LOOP_COUNT)
  const hiddenCount = loops.length - visible.length

  return (
    <section>
      <div className="px-1 pb-1 font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
        Loops - {loops.length}
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
          onClick={() => setView({ type: "loops", workspaceSlug, channelId })}
          className="mt-0.5 w-full cursor-pointer rounded-lg px-2 py-1.5 text-left text-muted-foreground text-xs transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
        >
          Show {hiddenCount} more…
        </button>
      )}
    </section>
  )
}
